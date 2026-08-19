/**
 * `ClaudeAdapter`: fetch + SSE against the Anthropic Messages API, emitting
 * harness StreamChunks. Transport-only: connection facts arrive through a
 * thunk resolved once per operation and the bearer token through a
 * per-request resolver, so the registering plugin owns validation, layering,
 * and credential policy (OAuth subscription or API key).
 *
 * @module dsh-claude-subscriptions/adapter
 */
import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  attributionHeaders,
  assertUsableApiKey,
} from '@deepseek-ai/dsh-llm';
import { serializeRequest, translateAnthropic, httpErrorCode, retryAfterMs } from './anthropic.js';
import { parseSse } from './sse.js';
import { DEFAULT_CONTEXT_WINDOW, PROVIDER } from './config.js';
import { streamConsole } from './cc-console.js';
import { streamSdk } from './cc-sdk.js';

const OFF_REASONING_EFFORT = ReasoningEffortId('off');
const LOW_REASONING_EFFORT = ReasoningEffortId('low');
const MEDIUM_REASONING_EFFORT = ReasoningEffortId('medium');
const HIGH_REASONING_EFFORT = ReasoningEffortId('high');
const XHIGH_REASONING_EFFORT = ReasoningEffortId('xhigh');
const MAX_REASONING_EFFORT = ReasoningEffortId('max');
const REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off' },
  { id: LOW_REASONING_EFFORT, name: 'Low' },
  { id: MEDIUM_REASONING_EFFORT, name: 'Medium' },
  { id: HIGH_REASONING_EFFORT, name: 'High' },
  { id: XHIGH_REASONING_EFFORT, name: 'XHigh' },
  { id: MAX_REASONING_EFFORT, name: 'Max' },
];
const OFF_ONLY_REASONING_EFFORTS = [{ id: OFF_REASONING_EFFORT, name: 'Off' }];

/** Idle watchdog: aborts the transport when no chunk arrives in time. */
class IdleWatchdog {
  constructor(timeoutMs, onTimeout) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.timer = undefined;
  }

  pulse() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onTimeout(), this.timeoutMs);
    if (this.timer.unref !== undefined) this.timer.unref();
  }

  stop() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

/** Adapter-owned model metadata for one catalog entry. */
function modelInfo(provider, model) {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...(model.description === undefined ? {} : { description: model.description }),
    inputModalities: ['text', 'image'],
  };
}

/** Extract the provider request id header (Anthropic: `request-id`). */
function requestId(headers) {
  const value = headers.get('request-id');
  return value === null || value.length === 0 ? undefined : value;
}

/** A per-request bearer resolution: subscription token or API key. */
async function resolveAuth(connection, resolveSubscriptionToken, credentials, launchEnvironment) {
  try {
    const subscription = await resolveSubscriptionToken();
    if (subscription !== undefined && subscription.token !== undefined) {
      return { kind: 'subscription', token: subscription.token, source: subscription.source };
    }
  } catch {
    // Subscription resolution failed — fall through to the API-key path.
  }
  if (connection.apiKeyEnv !== undefined) {
    if (credentials !== undefined) {
      const hit = await credentials.resolve(connection.apiKeyEnv);
      if (hit !== undefined) {
        return { kind: 'api-key', token: assertUsableApiKey(hit.value, 'llm-claude', connection.apiKeyEnv) };
      }
    }
    const ambient = launchEnvironment?.get(connection.apiKeyEnv);
    if (ambient !== undefined && ambient.value.length > 0) {
      return { kind: 'api-key', token: assertUsableApiKey(ambient.value, 'llm-claude', connection.apiKeyEnv) };
    }
  }
  throw new LlmError(
    `llm-claude: no credential for provider route "${PROVIDER}"; paste a token from \`claude setup-token\` in 设置 → 订阅, log in with Claude Code, or store ${connection.apiKeyEnv ?? 'ANTHROPIC_API_KEY'} through the credentials service`,
    'MISSING_CREDENTIAL',
  );
}

/** The first real Anthropic Messages adapter. One instance serves every catalog model. */
export class ClaudeAdapter extends LlmAdapter {
  constructor(deps) {
    super();
    this.deps = deps;
  }

  providerInfo(provider) {
    return { id: provider, name: 'Claude (订阅)' };
  }

  providerRetryPolicy(_provider) {
    return this.deps.options().retryPolicy;
  }

  listModels(provider) {
    return Promise.resolve(this.deps.options().models.map((model) => modelInfo(provider, model)));
  }

  resolveModel(provider, model, _signal) {
    const connection = this.deps.options();
    const configured = connection.models.find((entry) => entry.id === model);
    const contextWindow = configured?.contextWindow ?? connection.defaultContextWindow;
    const configuredEffort = connection.defaults.reasoningEffort;
    const reasoning = connection.defaults.thinking === 'disabled'
      ? { efforts: OFF_ONLY_REASONING_EFFORTS, defaultEffort: OFF_REASONING_EFFORT }
      : {
          efforts: REASONING_EFFORTS,
          defaultEffort:
            configuredEffort === 'off'
              ? OFF_REASONING_EFFORT
              : configuredEffort === 'low'
                ? LOW_REASONING_EFFORT
                : configuredEffort === 'medium'
                  ? MEDIUM_REASONING_EFFORT
                  : configuredEffort === 'xhigh'
                    ? XHIGH_REASONING_EFFORT
                    : configuredEffort === 'max'
                      ? MAX_REASONING_EFFORT
                      : HIGH_REASONING_EFFORT,
        };
    return Promise.resolve({
      ...(configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text', 'image'] }
        : modelInfo(provider, configured)),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
      reasoning,
    });
  }

  async *stream(options) {
    const connection = this.deps.options();
    // Console mode: drive the official `claude` CLI (first-party entitlement,
    // opus/sonnet available). No bearer auth involved. The harness-rendered
    // system prompt is NOT injected (it carries harness branding/instructions
    // that do not apply to Claude Code's own tools); an optional
    // `consoleSystemPrompt` setting replaces it.
    if (connection.mode === 'console') {
      try {
        const consoleOptions = { ...options, system: connection.consoleSystemPrompt };
        yield* streamConsole(consoleOptions, { signal: options.signal });
      } catch (error) {
        this.deps.logError?.(error);
        if (error instanceof LlmError) throw error;
        const causeMessage = error instanceof Error && error.message !== undefined && error.message.length > 0
          ? error.message
          : String(error);
        throw new LlmError(`claude console request failed: ${causeMessage}`, 'TRANSPORT', { cause: error });
      }
      return;
    }
    // SDK mode: Claude Agent SDK with the harness approval channel. The
    // harness system prompt is not injected (clean Claude persona) unless
    // consoleSystemPrompt is configured.
    if (connection.mode === 'sdk') {
      try {
        const sdkOptions = { ...options, system: connection.consoleSystemPrompt };
        yield* streamSdk(sdkOptions, {
          signal: options.signal,
          cwd: this.deps.getCwd?.(),
          askUser: this.deps.askUser,
          systemPrompt: connection.consoleSystemPrompt,
          logError: this.deps.logError,
        });
      } catch (error) {
        this.deps.logError?.(error);
        if (error instanceof LlmError) throw error;
        const causeMessage = error instanceof Error && error.message !== undefined && error.message.length > 0
          ? error.message
          : String(error);
        throw new LlmError(`claude sdk request failed: ${causeMessage}`, 'TRANSPORT', { cause: error });
      }
      return;
    }
    const consumer = new AbortController();
    let watchdog;
    let idleTimedOut = false;
    try {
      const auth = await resolveAuth(
        connection,
        this.deps.resolveSubscriptionToken,
        this.deps.getCredentials(),
        this.deps.launchEnvironment,
      );
      watchdog = new IdleWatchdog(connection.streamIdleTimeoutMs, () => {
        idleTimedOut = true;
        consumer.abort('llm-claude stream idle timeout');
      });
      watchdog.pulse();
      const signal = options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);

      const iterator = this.request(options, signal, connection, auth, this.deps.resolveUserId, () => watchdog.pulse());
      for await (const chunk of iterator) {
        watchdog.pulse();
        yield chunk;
      }
    } catch (error) {
      // Log the raw failure (stack included) so the host console shows the
      // real cause even when the harness renders only a short reason.
      try {
        this.deps.logError?.(error);
      } catch {
        // logging must never mask the failure
      }
      if (idleTimedOut === true) {
        throw new LlmError(`llm-claude stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error });
      }
      if (options.signal?.aborted) throw new LlmError('llm-claude request aborted by caller', 'ABORTED', { cause: error });
      if (error instanceof LlmError) throw error;
      const causeMessage = error instanceof Error && error.message !== undefined && error.message.length > 0
        ? error.message
        : String(error);
      throw new LlmError(`llm-claude request failed: ${causeMessage}`, 'TRANSPORT', { cause: error });
    } finally {
      watchdog?.stop();
      consumer.abort('llm-claude stream consumer stopped');
    }
  }

  async *request(options, signal, connection, auth, resolveUserId, onComment) {
    const resolveImage = async (attachmentRef, imageSignal) => {
      const attachments = this.deps.getAttachments();
      if (attachments === undefined) {
        throw new LlmError('image attachments are unavailable in this deployment', 'ATTACHMENT_UNAVAILABLE');
      }
      const stored = await attachments.readImage(attachmentRef, imageSignal);
      return { mediaType: stored.ref.mediaType, data: Buffer.from(stored.data).toString('base64') };
    };
    const buildHeaders = (effort) => {
      const betas = [
        // Subscription tokens ride the `oauth-*` beta gate (Claude Code sends
        // this on every OAuth-credential request).
        ...(auth.kind === 'subscription' ? ['oauth-2025-04-20'] : []),
        // `output_config.effort` + adaptive thinking (GA on the latest models).
        ...(effort ? ['effort-2025-11-24'] : []),
      ];
      return {
        authorization: `Bearer ${auth.token}`,
        'anthropic-version': '2023-06-01',
        ...(betas.length > 0 ? { 'anthropic-beta': betas.join(',') } : {}),
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...attributionHeaders(),
        ...(resolveUserId !== undefined ? { 'x-deepseek-harness-user-id': String(resolveUserId()) } : {}),
        ...(options.sessionId !== undefined ? { 'x-deepseek-harness-session-id': String(options.sessionId) } : {}),
        ...(options.purpose === 'compaction' ? { 'x-deepseek-harness-compact': '1' } : {}),
      };
    };
    const effortActive = () =>
      connection.defaults.thinking !== 'disabled' &&
      (options.reasoningEffort ?? connection.defaults.reasoningEffort) !== 'off';

    const post = async (body) => {
      try {
        return await fetch(`${connection.baseURL}/v1/messages`, {
          method: 'POST',
          headers: buildHeaders(effortActive()),
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new LlmError(`llm-claude API request to ${connection.baseURL} failed`, 'TRANSPORT', { cause: error });
      }
    };
    const hasRateLimitHeaders = (response) => {
      for (const [key] of response.headers) {
        if (key.toLowerCase().startsWith('anthropic-ratelimit-')) return true;
      }
      return false;
    };
    const parseError = async (response) => {
      let message = `Claude API error (HTTP ${response.status})`;
      let providerError;
      try {
        providerError = (await response.json()).error;
        if (providerError?.message !== undefined) message = providerError.message;
      } catch {
        // non-JSON error body — keep the generic message
      }
      // Anthropic's rate_limit_error carries the terse message "Error". A 429
      // WITHOUT anthropic-ratelimit-* headers is an entitlement rejection
      // (the token's plan is not entitled to the model via the API), not
      // quota exhaustion — probe evidence: opus/sonnet return no headers,
      // haiku does.
      if (providerError?.type === 'rate_limit_error' && (message === 'Error' || message === `Claude API error (HTTP ${response.status})`)) {
        message = hasRateLimitHeaders(response)
          ? `请求过于频繁（HTTP 429），请稍后重试`
          : `当前订阅（Pro）无权通过 API 使用该模型（opus/sonnet 通常如此），请改用 haiku，或切换到 API Key 模式使用旗舰模型`;
      }
      return { message, providerError };
    };
    const raiseError = (response, { message, providerError }) => {
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        status: response.status,
        ...(retryAfterMs(response.headers.get('retry-after')) === undefined
          ? {}
          : { providerRetryAfterMs: retryAfterMs(response.headers.get('retry-after')) }),
        ...(requestId(response.headers) === undefined ? {} : { requestId: requestId(response.headers) }),
      });
    };

    let body = await serializeRequest(options, connection.defaults, resolveImage, signal);
    let response = await post(body);
    if (!response.ok) {
      const failure = await parseError(response);
      const thinkingRejected =
        response.status === 400 &&
        /adaptive thinking|output_config|effort|thinking/i.test(failure.message);
      if (thinkingRejected && effortActive()) {
        // Older models (e.g. haiku-4-5) reject the adaptive/effort API: retry
        // once with thinking disabled.
        const noThinking = { ...options, reasoningEffort: 'off' };
        body = await serializeRequest(noThinking, connection.defaults, resolveImage, signal);
        response = await post(body);
        if (!response.ok) {
          const retryFailure = await parseError(response);
          raiseError(response, retryFailure);
        }
      } else {
        raiseError(response, failure);
      }
    }
    if (response.body === undefined) throw new LlmError('Claude API returned no response body', 'EMPTY_RESPONSE');
    yield* translateAnthropic(parseSse(response.body, onComment));
  }
}

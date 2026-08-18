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
import { exchangeForApiKey } from './oauth.js';

const OFF_REASONING_EFFORT = ReasoningEffortId('off');
const HIGH_REASONING_EFFORT = ReasoningEffortId('high');
const MAX_REASONING_EFFORT = ReasoningEffortId('max');
const REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off' },
  { id: HIGH_REASONING_EFFORT, name: 'High' },
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
    inputModalities: ['text'],
  };
}

/** Extract the provider request id header (Anthropic: `request-id`). */
function requestId(headers) {
  const value = headers.get('request-id');
  return value === null || value.length === 0 ? undefined : value;
}

/** A per-request bearer resolution: OAuth subscription or API key. */
async function resolveAuth(connection, resolveOAuthToken, credentials, launchEnvironment) {
  try {
    const oauth = await resolveOAuthToken();
    if (oauth !== undefined && oauth.accessToken !== undefined) {
      return { kind: 'oauth', token: oauth.accessToken };
    }
  } catch {
    // No OAuth session — fall through to the API-key path.
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
    `llm-claude: no credential for provider route "${PROVIDER}"; connect a Claude subscription in 设置 → 订阅, or store ${connection.apiKeyEnv ?? 'ANTHROPIC_API_KEY'} through the credentials service`,
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
    const reasoning = connection.defaults.thinking === 'disabled'
      ? { efforts: OFF_ONLY_REASONING_EFFORTS, defaultEffort: OFF_REASONING_EFFORT }
      : {
          efforts: REASONING_EFFORTS,
          defaultEffort:
            connection.defaults.reasoningEffort === 'off'
              ? OFF_REASONING_EFFORT
              : connection.defaults.reasoningEffort === 'max'
                ? MAX_REASONING_EFFORT
                : HIGH_REASONING_EFFORT,
        };
    return Promise.resolve({
      ...(configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text'] }
        : modelInfo(provider, configured)),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
      reasoning,
    });
  }

  async *stream(options) {
    const consumer = new AbortController();
    const connection = this.deps.options();
    let watchdog;
    try {
      const auth = await resolveAuth(
        connection,
        this.deps.resolveOAuthToken,
        this.deps.credentials,
        this.deps.launchEnvironment,
      );
      let idleTimedOut = false;
      watchdog = new IdleWatchdog(connection.streamIdleTimeoutMs, () => {
        idleTimedOut = true;
        consumer.abort('llm-claude stream idle timeout');
      });
      watchdog.pulse();
      const signal = options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);

      // Direct bearer attempt, then one token-exchange retry for OAuth tokens.
      let attempt = 0;
      let iterator;
      while (true) {
        attempt += 1;
        try {
          iterator = this.request(options, signal, connection, auth, this.deps.resolveUserId, () => watchdog.pulse());
          for await (const chunk of iterator) {
            watchdog.pulse();
            yield chunk;
          }
          return;
        } catch (error) {
          if (attempt >= 2 || auth.kind !== 'oauth' || !isAuthFailure(error)) throw error;
          // Exchange the subscription token for a short-lived API key and
          // retry once with the direct bearer replaced.
          const apiKey = await exchangeForApiKey(auth.token);
          if (apiKey === undefined) throw error;
          auth.kind = 'api-key';
          auth.token = apiKey;
        }
      }
    } catch (error) {
      if (idleTimedOut === true) {
        throw new LlmError(`llm-claude stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error });
      }
      if (options.signal?.aborted) throw new LlmError('llm-claude request aborted by caller', 'ABORTED', { cause: error });
      if (error instanceof LlmError) throw error;
      throw new LlmError(`llm-claude API stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error });
    } finally {
      watchdog?.stop();
      consumer.abort('llm-claude stream consumer stopped');
    }
  }

  async *request(options, signal, connection, auth, resolveUserId, onComment) {
    const body = serializeRequest(options, connection.defaults);
    const payload = JSON.stringify(body);
    const headers = {
      authorization: `Bearer ${auth.token}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...attributionHeaders(),
      ...(resolveUserId !== undefined ? { 'x-deepseek-harness-user-id': String(resolveUserId()) } : {}),
      ...(options.sessionId !== undefined ? { 'x-deepseek-harness-session-id': String(options.sessionId) } : {}),
      ...(options.purpose === 'compaction' ? { 'x-deepseek-harness-compact': '1' } : {}),
    };
    let response;
    try {
      response = await fetch(`${connection.baseURL}/v1/messages`, {
        method: 'POST',
        headers,
        body: payload,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new LlmError(`llm-claude API request to ${connection.baseURL} failed`, 'TRANSPORT', { cause: error });
    }
    if (!response.ok) {
      let message = `Claude API error (HTTP ${response.status})`;
      let providerError;
      try {
        providerError = (await response.json()).error;
        if (providerError?.message !== undefined) message = providerError.message;
      } catch {
        // non-JSON error body — keep the generic message
      }
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        status: response.status,
        ...(retryAfterMs(response.headers.get('retry-after')) === undefined
          ? {}
          : { providerRetryAfterMs: retryAfterMs(response.headers.get('retry-after')) }),
        ...(requestId(response.headers) === undefined ? {} : { requestId: requestId(response.headers) }),
      });
    }
    if (response.body === undefined) throw new LlmError('Claude API returned no response body', 'EMPTY_RESPONSE');
    yield* translateAnthropic(parseSse(response.body, onComment));
  }
}

/** Whether a thrown error is an auth failure worth a token-exchange retry. */
function isAuthFailure(error) {
  return error instanceof LlmError && error.code === 'AUTH';
}

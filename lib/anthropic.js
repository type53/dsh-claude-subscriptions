/**
 * Wire translation between the harness message/stream vocabulary and the
 * Anthropic Messages API (subscription / OAuth or API-key auth).
 *
 * Serialization: harness `Message[]` → Anthropic `messages` body.
 * Translation: Anthropic SSE events → harness `StreamChunk`s.
 *
 * @module dsh-claude-subscriptions/anthropic
 */
import {
  CallId,
  EMPTY_RESPONSE_CODE,
  LlmError,
  isContextWindowExceededError,
  isQuotaExceededError,
} from '@deepseek-ai/dsh-llm';
import { DEFAULT_MAX_TOKENS } from './config.js';

/** Thinking budgets per harness reasoning effort (pre-4.6 models only). */
const THINKING_BUDGETS = { high: 12000, max: 32000 };

/** API effort levels per harness reasoning effort (4.6+ models). */
const EFFORT_LEVELS = { high: 'high', max: 'max' };

/**
 * Whether a model takes the adaptive thinking API rather than the legacy one.
 *
 * Claude 4.6 and newer accept `thinking: {type:'adaptive'}` with the depth set
 * by `output_config.effort`, and reject both `budget_tokens` and the sampling
 * parameters (`temperature`/`top_p`/`top_k`) with a 400. Older models are the
 * mirror image: `budget_tokens` is how thinking is requested, and
 * `temperature` is accepted.
 *
 * Unparseable ids are treated as current. The catalog is discovered from the
 * live `/v1/models` listing, so an id this function does not recognize is far
 * more likely to be newer than this rule than older.
 */
function isAdaptiveThinkingModel(model) {
  const id = typeof model === 'string' ? model : '';
  // Pre-4 ids put the version first (`claude-3-7-sonnet-…`); none are adaptive.
  if (/^claude-\d/.test(id)) return false;
  const match = /^claude-[a-z]+-(\d+)(?:-(\d+))?/.exec(id);
  if (match === null) return true;
  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  return major >= 5 || (major === 4 && minor >= 6);
}

/** Join the text blocks of a message (used for user/tool-result/system content). */
function flattenText(blocks) {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * Resolve one legal thinking configuration for the wire request.
 * @param adaptive - whether the target model takes the adaptive thinking API.
 * @returns `{ thinking, effort }`; an absent field means "omit from the body".
 */
function resolveThinking(options, defaults, adaptive) {
  if (options.purpose === 'session-title') return {};
  const enabled = (defaults.thinking ?? 'enabled') === 'enabled';
  const effort = options.reasoningEffort ?? defaults.reasoningEffort;
  if (!enabled || effort === undefined || effort === 'off') return {};
  if (adaptive) {
    // The model decides how much to think; `effort` sets the depth. `display`
    // must be requested explicitly — it defaults to `omitted`, which streams
    // thinking blocks whose text is empty.
    return {
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: EFFORT_LEVELS[effort] ?? 'high',
    };
  }
  const budget = THINKING_BUDGETS[effort] ?? 4096;
  const maxTokens = options.maxTokens ?? defaults.maxTokens ?? DEFAULT_MAX_TOKENS;
  // Anthropic requires budget_tokens <= max_tokens with headroom.
  const capped = Math.max(1024, Math.min(budget, Math.floor(maxTokens * 0.8)));
  return { thinking: { type: 'enabled', budget_tokens: capped } };
}

/** Parse a harness tool-call argument string into the Anthropic input object. */
function parseArguments(raw) {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    // Unparseable: hand the raw string to the API, which will reject it with a
    // precise message rather than us silently mangling the call.
    return raw;
  }
}

/** Append a block, merging adjacent text blocks into one. */
function pushBlock(blocks, block) {
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last.type === 'text' && block.type === 'text') last.text += block.text;
  else blocks.push(block);
}

/** Merge two block arrays, folding adjacent text blocks. */
function mergeContents(first, second) {
  const out = first.slice();
  for (const block of second) pushBlock(out, block);
  return out;
}

/** Whether one harness reasoning block still carries what replay needs. */
function replayableReasoning(block) {
  return (
    (typeof block.signature === 'string' && block.signature.length > 0) ||
    (typeof block.redactedData === 'string' && block.redactedData.length > 0)
  );
}

/**
 * Serialize one assistant message: thinking → `thinking`/`redacted_thinking`
 * blocks, text → text blocks, tool calls → `tool_use` blocks.
 *
 * With thinking enabled, an assistant turn that carries tool calls must replay
 * its thinking blocks verbatim — signature included — or the API rejects the
 * message. Thinking leads the content because the API requires it there. A
 * block whose signature did not survive storage cannot be replayed at all, and
 * a partial set is likelier to be rejected than none, so it is all or nothing.
 */
function serializeAssistant(message) {
  const blocks = [];
  const reasoning = message.content.filter((block) => block.type === 'reasoning');
  if (reasoning.length > 0 && reasoning.every(replayableReasoning)) {
    for (const block of reasoning) {
      blocks.push(
        typeof block.redactedData === 'string' && block.redactedData.length > 0
          ? { type: 'redacted_thinking', data: block.redactedData }
          : { type: 'thinking', thinking: block.text, signature: block.signature },
      );
    }
  }
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        pushBlock(blocks, { type: 'text', text: block.text });
        break;
      case 'tool-call':
        blocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: parseArguments(block.arguments),
        });
        break;
      case 'reasoning': // emitted above, ahead of every other block
      case 'image':
      default:
        break;
    }
  }
  return { role: 'assistant', content: blocks };
}

/**
 * Serialize one user message: text, tool results, and images (resolved via
 * the provided callback).
 * @param message - the harness user message.
 * @param resolveImage - `async (attachmentRef, signal) => { mediaType, data }`.
 * @param signal - caller cancellation, forwarded to image resolution.
 */
async function serializeUser(message, resolveImage, signal) {
  const blocks = [];
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        pushBlock(blocks, { type: 'text', text: block.text });
        break;
      case 'image': {
        const image = await resolveImage(block.attachment, signal);
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.data },
        });
        break;
      }
      case 'tool-result': {
        const text = flattenText(block.content) || '(no output)';
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.toolCallId,
          content: text,
          ...(block.isError === true ? { is_error: true } : {}),
        });
        break;
      }
      default:
        break;
    }
  }
  return { role: 'user', content: blocks };
}

/**
 * Serialize the conversation. System-role messages are hoisted into the
 * top-level `system` text; adjacent same-role wire messages are merged, as
 * the Anthropic API requires strictly alternating roles.
 * @param messages - the harness conversation, in order.
 * @param resolveImage - see {@link serializeUser}.
 * @param signal - caller cancellation, forwarded to image resolution.
 * @returns the wire messages plus the hoisted system text.
 */
export async function serializeMessages(messages, resolveImage, signal) {
  const systemTexts = [];
  const wire = [];
  for (const message of messages) {
    if (message.role === 'system') {
      systemTexts.push(flattenText(message.content));
      continue;
    }
    const blocks = message.role === 'assistant'
      ? serializeAssistant(message)
      : await serializeUser(message, resolveImage, signal);
    if (blocks.content.length === 0) continue;
    const last = wire[wire.length - 1];
    if (last !== undefined && last.role === blocks.role) {
      last.content = mergeContents(last.content, blocks.content);
    } else {
      wire.push(blocks);
    }
  }
  return { system: systemTexts.filter((text) => text.length > 0).join('\n\n'), messages: wire };
}

/**
 * Build the full wire request. Always streaming; `max_tokens` is mandatory
 * for the Anthropic API.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level defaults; undefined fields put nothing on the wire.
 * @param resolveImage - see {@link serializeUser}; pass a no-op to omit images.
 * @param signal - caller cancellation, forwarded to image resolution.
 * @returns the Messages API request body.
 */
export async function serializeRequest(options, defaults, resolveImage, signal) {
  const { system, messages } = await serializeMessages(options.messages, resolveImage, signal);
  const systemText = [options.system, system].filter((text) => text !== undefined && text.length > 0).join('\n\n');
  const tools = options.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
  const adaptive = isAdaptiveThinkingModel(options.model);
  const { thinking, effort } = resolveThinking(options, defaults, adaptive);
  // `temperature` is rejected outright on 4.6+ models, and on older ones it is
  // illegal alongside extended thinking (which pins it to 1).
  const sampling =
    !adaptive && thinking === undefined && options.temperature !== undefined
      ? { temperature: options.temperature }
      : {};
  return {
    model: options.model,
    messages,
    max_tokens: options.maxTokens ?? defaults.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
    ...(systemText.length > 0 ? { system: systemText } : {}),
    ...(thinking === undefined ? {} : { thinking }),
    ...(effort === undefined ? {} : { output_config: { effort } }),
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...sampling,
    ...(options.stop !== undefined && options.stop.length > 0 ? { stop_sequences: options.stop } : {}),
  };
}

/** Map the wire stop_reason vocabulary to the harness FinishReason. */
function mapStopReason(reason) {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
    case 'pause_turn':
    case 'refusal':
      return { kind: 'stop' };
    case 'tool_use':
      return { kind: 'tool-calls' };
    case 'max_tokens':
      return { kind: 'max-tokens' };
    default:
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: String(reason).toUpperCase() },
      };
  }
}

/** Harness block type for each Anthropic content-block kind we track. */
const HARNESS_BLOCK_TYPES = {
  text: 'text',
  thinking: 'reasoning',
  redacted_thinking: 'reasoning',
  tool_use: 'tool-call',
};

/**
 * Assemble the final ContentBlock for one open block. Thinking blocks keep
 * their `signature` (and redacted blocks their `data`) so the next turn can
 * replay them; see {@link serializeAssistant}.
 */
function closeBlock(block) {
  switch (block.kind) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'thinking':
      return {
        type: 'reasoning',
        text: block.text,
        ...(block.signature === undefined ? {} : { signature: block.signature }),
      };
    case 'redacted_thinking':
      return { type: 'reasoning', text: '', redactedData: block.redactedData ?? '' };
    case 'tool_use':
      return {
        type: 'tool-call',
        id: CallId(block.callId ?? ''),
        name: block.name ?? '',
        // A parameterless tool emits no input_json_delta at all, leaving the
        // accumulator empty; both sides of this seam expect a JSON object.
        arguments: block.text.length > 0 ? block.text : '{}',
      };
    default:
      throw new LlmError(`unexpected Anthropic block kind: ${block.kind}`, 'MALFORMED_RESPONSE');
  }
}

/**
 * Consume parsed SSE events (from {@link parseSse}) and yield StreamChunks.
 * The `message_stop` event ends the stream: pending usage and the finish are
 * emitted there, and nothing may follow them.
 * @param events - async iterable of `{ event, data }` from the Anthropic stream.
 * @returns harness chunks in arrival order.
 */
export async function* translateAnthropic(events) {
  const blocks = new Map();
  const order = [];
  let pendingFinish;
  let pendingUsage;

  for await (const { event, data } of events) {
    if (event === 'ping') continue;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new LlmError(`malformed SSE payload: ${data.slice(0, 120)}`, 'MALFORMED_RESPONSE');
    }
    switch (payload.type) {
      case 'message_start': {
        const usage = payload.message?.usage ?? {};
        pendingUsage = {
          inputTokens: usage.input_tokens ?? 0,
          ...(usage.cache_read_input_tokens !== undefined ? { cacheReadTokens: usage.cache_read_input_tokens } : {}),
          ...(usage.cache_creation_input_tokens !== undefined ? { cacheWriteTokens: usage.cache_creation_input_tokens } : {}),
        };
        break;
      }
      case 'content_block_start': {
        const contentBlock = payload.content_block;
        const blockType = HARNESS_BLOCK_TYPES[contentBlock.type];
        if (blockType === undefined) break;
        // Key off the wire index, which every delta for this block also
        // carries; a parallel counter only stays aligned by coincidence.
        const block = {
          index: payload.index,
          kind: contentBlock.type,
          text: '',
          ...(contentBlock.type === 'tool_use' ? { callId: contentBlock.id, name: contentBlock.name } : {}),
          ...(contentBlock.type === 'redacted_thinking' ? { redactedData: contentBlock.data } : {}),
        };
        blocks.set(block.index, block);
        order.push(block);
        yield { type: 'block-start', index: block.index, blockType };
        break;
      }
      case 'content_block_delta': {
        const block = blocks.get(payload.index);
        if (block === undefined) break;
        const delta = payload.delta;
        if (delta.type === 'text_delta') {
          block.text += delta.text;
          yield { type: 'text-delta', index: block.index, text: delta.text };
        } else if (delta.type === 'thinking_delta') {
          block.text += delta.thinking;
          yield { type: 'reasoning-delta', index: block.index, text: delta.thinking };
        } else if (delta.type === 'input_json_delta') {
          block.text += delta.partial_json;
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: CallId(block.callId ?? ''),
            ...(block.name !== undefined ? { name: block.name } : {}),
            argumentsDelta: delta.partial_json,
          };
        } else if (delta.type === 'signature_delta') {
          // Not model content, so nothing is yielded — but it must be kept:
          // replaying a thinking block without its signature is rejected.
          block.signature = (block.signature ?? '') + delta.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const block = blocks.get(payload.index);
        if (block === undefined) break;
        yield { type: 'block-end', index: block.index, block: closeBlock(block) };
        break;
      }
      case 'message_delta': {
        if (payload.delta?.stop_reason !== undefined) pendingFinish = mapStopReason(payload.delta.stop_reason);
        if (payload.usage?.output_tokens !== undefined) {
          pendingUsage ??= { inputTokens: 0 };
          pendingUsage.outputTokens = payload.usage.output_tokens;
        }
        break;
      }
      case 'message_stop': {
        if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage };
        const reason = pendingFinish ?? { kind: 'stop' };
        yield {
          type: 'finish',
          reason:
            reason.kind === 'stop' && order.length === 0
              ? {
                  kind: 'error',
                  failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
                }
              : reason,
        };
        return;
      }
      case 'error': {
        const providerError = payload.error ?? {};
        throw new LlmError(
          providerError.message ?? 'Anthropic stream error',
          typeof providerError.type === 'string' && providerError.type.length > 0 ? providerError.type.toUpperCase() : 'ANTHROPIC_ERROR',
        );
      }
      default:
        break;
    }
  }
  throw new LlmError('SSE stream ended without message_stop', 'STREAM_CLOSED');
}

/** Parse a `retry-after` header into a delay in milliseconds, when valid. */
export function retryAfterMs(value) {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000;
    return Number.isFinite(delay) && delay > 0 ? delay : undefined;
  }
  const delay = Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}

/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param error - parsed provider error body, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status, error) {
  if (status === 401 || status === 403) return 'AUTH';
  const detail = [error?.type, error?.message].filter(Boolean).join(' ');
  if (isQuotaExceededError(detail)) return 'QUOTA_EXCEEDED';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return 'CONTEXT_WINDOW_EXCEEDED';
    return 'INVALID_REQUEST';
  }
  if (status >= 500) return 'SERVER';
  return `HTTP_${status}`;
}

/**
 * Fetch the model catalog from the Anthropic Models API.
 * @param baseURL - API root (without `/v1`).
 * @param token - bearer token (subscription OAuth or API key).
 * @param signal - optional cancellation.
 * @returns the advertised models as `{ id, name }`.
 */
export async function fetchModels(baseURL, token, signal) {
  const response = await fetch(`${baseURL}/v1/models`, {
    method: 'GET',
    headers: {
      'anthropic-version': '2023-06-01',
      authorization: `Bearer ${token}`,
    },
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!response.ok) {
    let message = `Claude models endpoint error (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message !== undefined) message = body.error.message;
    } catch {
      // non-JSON body
    }
    throw new LlmError(message, httpErrorCode(response.status, undefined));
  }
  const body = await response.json();
  const list = Array.isArray(body?.data) ? body.data : [];
  return list
    .filter((model) => typeof model?.id === 'string' && model.id.length > 0)
    .map((model) => ({
      id: model.id,
      name: typeof model.display_name === 'string' && model.display_name.length > 0 ? model.display_name : model.id,
    }));
}

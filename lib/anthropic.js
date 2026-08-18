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
  contentHasImage,
  isContextWindowExceededError,
  isQuotaExceededError,
} from '@deepseek-ai/dsh-llm';
import { DEFAULT_MAX_TOKENS } from './config.js';

/** Thinking budgets per harness reasoning effort. */
const THINKING_BUDGETS = { high: 12000, max: 32000 };

/** Join the text blocks of a message (used for user/tool-result/system content). */
function flattenText(blocks) {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/** Reject image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks) {
  if (contentHasImage(blocks)) {
    throw new LlmError('The Claude adapter does not support image content.', 'UNSUPPORTED_CONTENT');
  }
}

/**
 * Resolve one legal thinking configuration for the wire request.
 * Returns undefined to omit the field (Anthropic defaults apply).
 */
function resolveThinking(options, defaults) {
  if (options.purpose === 'session-title') return undefined;
  const enabled = (defaults.thinking ?? 'enabled') === 'enabled';
  const effort = options.reasoningEffort ?? defaults.reasoningEffort;
  if (!enabled || effort === undefined || effort === 'off') return undefined;
  const budget = THINKING_BUDGETS[effort] ?? 4096;
  const maxTokens = options.maxTokens ?? defaults.maxTokens ?? DEFAULT_MAX_TOKENS;
  // Anthropic requires budget_tokens <= max_tokens with headroom.
  const capped = Math.max(1024, Math.min(budget, Math.floor(maxTokens * 0.8)));
  return { type: 'enabled', budget_tokens: capped };
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

/**
 * Serialize one assistant message: text → text blocks, tool calls →
 * `tool_use` blocks, reasoning dropped (thinking is not accepted back).
 */
function serializeAssistant(message) {
  const blocks = [];
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
      case 'reasoning':
      case 'image':
      default:
        break;
    }
  }
  return { role: 'assistant', content: blocks };
}

/** Serialize one user message: text and tool results, images rejected. */
function serializeUser(message) {
  const blocks = [];
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        pushBlock(blocks, { type: 'text', text: block.text });
        break;
      case 'tool-result': {
        assertTextOnly(block.content);
        const text = flattenText(block.content) || '(no output)';
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.toolCallId,
          content: text,
          ...(block.isError === true ? { is_error: true } : {}),
        });
        break;
      }
      case 'image':
        throw new LlmError('The Claude adapter does not support image content.', 'UNSUPPORTED_CONTENT');
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
 * @returns the wire messages plus the hoisted system text.
 */
export function serializeMessages(messages) {
  const systemTexts = [];
  const wire = [];
  for (const message of messages) {
    if (message.role === 'system') {
      systemTexts.push(flattenText(message.content));
      continue;
    }
    assertTextOnly(message.content);
    const blocks = message.role === 'assistant' ? serializeAssistant(message) : serializeUser(message);
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
 * @returns the Messages API request body.
 */
export function serializeRequest(options, defaults) {
  const { system, messages } = serializeMessages(options.messages);
  const systemText = [options.system, system].filter((text) => text !== undefined && text.length > 0).join('\n\n');
  const tools = options.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
  const thinking = resolveThinking(options, defaults);
  return {
    model: options.model,
    messages,
    max_tokens: options.maxTokens ?? defaults.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
    ...(systemText.length > 0 ? { system: systemText } : {}),
    ...(thinking === undefined ? {} : { thinking }),
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    // Extended thinking requires temperature unset (defaults to 1).
    ...(options.temperature !== undefined && thinking === undefined ? { temperature: options.temperature } : {}),
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

/** Assemble the final ContentBlock for one open block. */
function closeBlock(block) {
  switch (block.kind) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'thinking':
      return { type: 'reasoning', text: block.text };
    case 'tool_use':
      return {
        type: 'tool-call',
        id: CallId(block.callId ?? ''),
        name: block.name ?? '',
        arguments: block.text,
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
  let nextIndex = 0;
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
        const block = {
          index: nextIndex++,
          kind: contentBlock.type,
          text: '',
          ...(contentBlock.type === 'tool_use' ? { callId: contentBlock.id, name: contentBlock.name } : {}),
        };
        if (block.kind === 'text' || block.kind === 'thinking' || block.kind === 'tool_use') {
          blocks.set(block.index, block);
          order.push(block);
          yield {
            type: 'block-start',
            index: block.index,
            blockType: block.kind === 'thinking' ? 'reasoning' : block.kind === 'tool_use' ? 'tool-call' : 'text',
          };
        }
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
        }
        // signature_delta carries chain-of-thought verification, not model
        // content — intentionally skipped.
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

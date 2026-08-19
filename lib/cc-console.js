/**
 * Claude Code console mode: drive the official `claude` CLI (print mode) as
 * the model backend.
 *
 * Why this exists: subscription OAuth tokens hit an entitlement wall on the
 * raw Messages API (opus/sonnet → 429, haiku only). The `claude` CLI itself
 * carries the first-party entitlement, so opus/sonnet work when Claude Code
 * makes the call. This module runs one `claude -p` invocation per model step
 * with the full conversation transcript on stdin and maps its `stream-json`
 * events onto harness StreamChunks. Claude Code executes its own tools inside
 * the invocation (shape A: managed whole-turn agent); the harness receives
 * only the final text, no tool-calls.
 *
 * @module dsh-claude-subscriptions/cc-console
 */
import { spawn } from 'node:child_process';

/** Transcript tags Claude Code understands for continuation prompts. */
const USER_OPEN = '<user>';
const USER_CLOSE = '</user>';
const ASSISTANT_OPEN = '<assistant>';
const ASSISTANT_CLOSE = '</assistant>';

/** Render one content block as text (tool results flattened to text). */
function blockText(block) {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'reasoning':
      return '';
    case 'tool-result':
      return block.content
        .map((nested) => (nested.type === 'text' ? nested.text : ''))
        .join('')
        .trim();
    case 'image':
      return '[image]';
    case 'tool-call':
      return '';
    default:
      return '';
  }
}

/**
 * Build the `claude -p` invocation for one model step: the harness system
 * prompt is passed via `--append-system-prompt`, and the conversation is
 * rendered as a role-tagged transcript on stdin.
 * @param options - the harness request.
 * @returns `{ args, stdin }`.
 */
export function buildTranscript(options) {
  const parts = [];
  for (const message of options.messages ?? []) {
    if (message.role === 'system') continue; // hoisted via --append-system-prompt
    const open = message.role === 'assistant' ? ASSISTANT_OPEN : USER_OPEN;
    const close = message.role === 'assistant' ? ASSISTANT_CLOSE : USER_CLOSE;
    const text = (message.content ?? []).map(blockText).filter((part) => part.length > 0).join('\n');
    if (text.length === 0) continue;
    parts.push(`${open}\n${text}\n${close}`);
  }
  const args = [
    '-p',
    '--model',
    options.model,
    '--output-format',
    'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];
  if (options.system !== undefined && options.system.length > 0) {
    args.push('--append-system-prompt', options.system);
  }
  return { args, stdin: parts.join('\n\n') };
}

/**
 * Stream one model step through a `claude -p` subprocess.
 * @param options - the harness request (must carry a real model id).
 * @param deps - `{ signal }`; stdout is parsed line by line as stream-json.
 * @returns harness StreamChunks.
 */
export async function* streamConsole(options, deps) {
  const { args, stdin } = buildTranscript(options);
  const child = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const onAbort = () => child.kill();
  deps.signal?.addEventListener('abort', onAbort, { once: true });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  let sawResult = false;
  try {
    child.stdin.end(stdin);
    const rl = readLines(child.stdout);
    for await (const line of rl) {
      if (line.trim().length === 0) continue;
      const event = parseEvent(line);
      if (event === undefined) continue;
      if (event.type === 'result') sawResult = true;
      const chunks = mapEvent(event);
      for (const chunk of chunks) yield chunk;
    }
    // If the process ends without a result event, surface any CLI error.
    if (!sawResult) {
      const detail = stderr.trim().slice(0, 500);
      throw new Error(`claude CLI ended without a result${detail ? `: ${detail}` : ''}`);
    }
  } catch (error) {
    const detail = stderr.trim().slice(0, 500);
    if (detail.length > 0 && !String(error.message).includes(detail)) {
      error.message = `${error.message}${detail ? ` — ${detail}` : ''}`;
    }
    throw error;
  } finally {
    deps.signal?.removeEventListener('abort', onAbort);
  }
}

/** Parse one stream-json line; tolerate malformed lines (skip them). */
export function parseEvent(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * Map one stream-json event to harness StreamChunks. The `assistant` events
 * carry full message blocks (not deltas); text is emitted as deltas and
 * tool-use blocks are skipped (Claude Code executes its own tools). The
 * `result` event carries usage and the terminal outcome.
 */
export function mapEvent(event) {
  const chunks = [];
  switch (event.type) {
    case 'assistant': {
      const content = event.message?.content ?? [];
      for (const block of content) {
        if (block.type === 'text') {
          const index = nextIndex();
          chunks.push({ type: 'block-start', index, blockType: 'text' });
          chunks.push({ type: 'text-delta', index, text: block.text });
          chunks.push({ type: 'block-end', index, block: { type: 'text', text: block.text } });
        }
        // tool_use blocks: executed inside Claude Code — not surfaced.
      }
      break;
    }
    case 'result': {
      if (event.is_error === true) {
        const message = Array.isArray(event.errors) && event.errors.length > 0
          ? String(event.errors[0])
          : event.subtype ?? 'claude CLI error';
        chunks.push({
          type: 'finish',
          reason: { kind: 'error', failure: { message, code: 'PROVIDER_ERROR' } },
        });
        break;
      }
      const usage = event.usage;
      chunks.push({
        type: 'usage',
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          ...(usage?.cache_read_input_tokens !== undefined
            ? { cacheReadTokens: usage.cache_read_input_tokens }
            : {}),
          ...(usage?.cache_creation_input_tokens !== undefined
            ? { cacheWriteTokens: usage.cache_creation_input_tokens }
            : {}),
        },
      });
      chunks.push({ type: 'finish', reason: { kind: 'stop' } });
      break;
    }
    default:
      // system/init, progress, user, rate_limit_event — ignored.
      break;
  }
  return chunks;
}

let blockCounter = 0;
/** Per-process block index (monotonic within a stream). */
function nextIndex() {
  return blockCounter++;
}

/** Async line reader over a ReadableStream. */
async function* readLines(stream) {
  const decoder = new TextDecoder('utf8');
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) yield buffer;
}

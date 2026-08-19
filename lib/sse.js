/**
 * Minimal dependency-free SSE parser for the Anthropic Messages streaming
 * endpoint. Handles CRLF/LF event framing, multi-line `data:` fields, and
 * comment lines. Reads an async-iterable of Uint8Array chunks.
 *
 * @module dsh-claude-subscriptions/sse
 */

/**
 * Parse an SSE byte stream into `{ event, data }` events.
 *
 * The decoder is per-call, never module-level: `decode(chunk, {stream: true})`
 * carries partial multi-byte characters between calls, so a decoder shared
 * across concurrent streams corrupts and drops each other's events.
 *
 * @param input - async iterable of Uint8Array chunks (a fetch body works).
 * @param onComment - optional callback for comment lines (transport liveness).
 * @returns each parsed event in arrival order.
 */
export async function* parseSse(input, onComment) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    // Split on blank lines (event terminator). Both \r\n\r\n and \n\n are
    // legal; handle \r\n line endings by normalizing on the fly.
    while ((boundary = findBoundary(buffer)) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary);
      const event = parseBlock(block, onComment);
      if (event !== undefined) yield event;
    }
  }
  // Trailing block without a blank-line terminator is still emitted.
  buffer += decoder.decode();
  const trailing = buffer.trim();
  if (trailing.length > 0) {
    const event = parseBlock(trailing, onComment);
    if (event !== undefined) yield event;
  }
}

/** Locate the end of one SSE event block (index just past the blank line). */
function findBoundary(text) {
  const crlf = text.indexOf('\r\n\r\n');
  if (crlf !== -1) return crlf + 4;
  const lf = text.indexOf('\n\n');
  if (lf !== -1) return lf + 2;
  return -1;
}

/**
 * Parse one SSE block (terminated, without the trailing blank line) into an
 * event. Comment blocks (a leading `:`) yield nothing.
 */
function parseBlock(block, onComment) {
  let eventName = 'message';
  const dataLines = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) continue;
    if (line.startsWith(':')) {
      if (onComment !== undefined) onComment(line.slice(1));
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
    // `id` / `retry` are not needed by the Anthropic stream.
  }
  if (dataLines.length === 0) return undefined;
  return { event: eventName, data: dataLines.join('\n') };
}

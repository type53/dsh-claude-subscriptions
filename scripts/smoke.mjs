/**
 * Smoke test: exercises the wire translation and config without any network
 * (except the fetchModels test, which mocks `fetch`).
 * Run: node scripts/smoke.mjs
 */
import assert from 'node:assert/strict';
import { serializeRequest, serializeMessages, translateAnthropic, fetchModels } from '../lib/anthropic.js';
import { parseSse } from '../lib/sse.js';
import { Config, resolveAdapterOptions, DEFAULT_MODELS } from '../lib/config.js';
import { ClaudeAdapter } from '../lib/adapter.js';
import { OAuthManager } from '../lib/oauth.js';

let passed = 0;
const checks = [];
function ok(name, fn) {
  checks.push(
    (async () => {
      try {
        await fn();
        passed += 1;
        console.log(`  ok  ${name}`);
      } catch (error) {
        console.error(`FAIL ${name}`);
        console.error(error);
        process.exitCode = 1;
      }
    })(),
  );
}

/** Image resolver stub: never called unless a message carries an image. */
const noImages = async () => {
  throw new Error('unexpected image resolution');
};

// ── 1. Config schema + resolution ──────────────────────────────────────────
ok('Config normalizes defaults', () => {
  const resolved = Config({});
  assert.equal(resolved.thinking, 'enabled');
  assert.equal(resolved.models.length, DEFAULT_MODELS.length);
  // schemastery materializes the optional nested objects as empty objects —
  // callers must gate on their inner fields, not their presence.
  assert.deepEqual(resolved.flow, {});
  assert.deepEqual(resolved.auth, {});
});

ok('resolveAdapterOptions applies defaults', () => {
  const opts = resolveAdapterOptions({});
  assert.equal(opts.baseURL, 'https://api.anthropic.com');
  assert.equal(opts.apiKeyEnv, undefined);
  assert.equal(opts.defaults.thinking, 'enabled');
  assert.ok(opts.retryPolicy);
});

ok('resolveAdapterOptions rejects bad effort', () => {
  assert.throws(() => resolveAdapterOptions({ thinking: 'disabled', reasoningEffort: 'high' }));
});

// ── 2. Message serialization ───────────────────────────────────────────────
ok('serializeMessages merges roles and hoists system', async () => {
  const messages = [
    { role: 'system', content: [{ type: 'text', text: 'sys1' }] },
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    { role: 'user', content: [{ type: 'text', text: ' again' }] },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'hidden thinking' },
        { type: 'text', text: 'let me check' },
        { type: 'tool-call', id: 'call_1', name: 'read_file', arguments: '{"path":"a.js"}' },
      ],
    },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_1', content: [{ type: 'text', text: 'contents' }] }] },
  ];
  const { system, messages: wire } = await serializeMessages(messages, noImages);
  assert.equal(system, 'sys1');
  assert.equal(wire.length, 3);
  assert.deepEqual(wire[0], { role: 'user', content: [{ type: 'text', text: 'hello again' }] });
  assert.deepEqual(wire[1].content[1], { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.js' } });
  assert.deepEqual(wire[2].content[0], {
    type: 'tool_result',
    tool_use_id: 'call_1',
    content: 'contents',
  });
  // reasoning was dropped
  assert.ok(!wire[1].content.some((b) => b.type === 'thinking'));
});

ok('serializeRequest builds a full body', async () => {
  const body = await serializeRequest(
    {
      provider: 'claude-subscription',
      model: 'claude-sonnet-4-5',
      system: 'be concise',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
      reasoningEffort: 'high',
      maxTokens: 16000,
      stop: ['<|end|>'],
    },
    resolveAdapterOptions({}),
    noImages,
  );
  assert.equal(body.model, 'claude-sonnet-4-5');
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 16000);
  assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 12000 });
  assert.equal(body.temperature, undefined);
  assert.deepEqual(body.stop_sequences, ['<|end|>']);
  assert.equal(body.system, 'be concise');
});

ok('thinking disabled omits thinking', async () => {
  const body = await serializeRequest(
    { provider: 'p', model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] },
    resolveAdapterOptions({ thinking: 'disabled', reasoningEffort: 'off' }),
    noImages,
  );
  assert.equal(body.thinking, undefined);
});

ok('serializeMessages emits an Anthropic image block', async () => {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1 } },
      ],
    },
  ];
  const resolveImage = async (ref) => {
    assert.equal(ref.attachmentId, 'img-1');
    return { mediaType: 'image/png', data: 'aGVsbG8=' };
  };
  const { messages: wire } = await serializeMessages(messages, resolveImage);
  assert.deepEqual(wire[0].content[0], { type: 'text', text: 'look at this' });
  assert.deepEqual(wire[0].content[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
  });
});

ok('fetchModels maps the Anthropic models listing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/models');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { type: 'model', id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
          { type: 'model', id: 'claude-haiku-4-5' },
        ],
      }),
    };
  };
  try {
    const models = await fetchModels('https://api.anthropic.com', 'tok');
    assert.equal(models.length, 2);
    assert.deepEqual(models[0], { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' });
    assert.deepEqual(models[1], { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── 3. SSE parsing ─────────────────────────────────────────────────────────
ok('parseSse splits CRLF and multi-line data', async () => {
  const bytes = new TextEncoder().encode(
    'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\r\n\r\n' +
      'data: line1\r\ndata: line2\r\n\r\n' +
      ': keepalive comment\r\n\r\n',
  );
  const events = [];
  for await (const event of parseSse([bytes])) events.push(event);
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'content_block_delta');
  assert.equal(events[1].data, 'line1\nline2');
});

// ── 4. SSE → StreamChunk translation ───────────────────────────────────────
ok('translateAnthropic maps a text + thinking + tool stream', async () => {
  const events = (async function* () {
    yield { event: 'message_start', data: JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 12, cache_read_input_tokens: 3 } } }) };
    yield { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) };
    yield { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'so ' } }) };
    yield { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'far' } }) };
    yield { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 0 }) };
    yield { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }) };
    yield { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Sure' } }) };
    yield { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 1 }) };
    yield { event: 'content_block_start', data: JSON.stringify({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} } }) };
    yield { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"p":' } }) };
    yield { event: 'content_block_delta', data: JSON.stringify({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"x"}' } }) };
    yield { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 2 }) };
    yield { event: 'message_delta', data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 33 } }) };
    yield { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) };
  })();
  const chunks = [];
  for await (const chunk of translateAnthropic(events)) chunks.push(chunk);
  const types = chunks.map((c) => c.type);
  assert.ok(types.includes('block-start'));
  assert.ok(types.includes('reasoning-delta'));
  assert.ok(types.includes('text-delta'));
  assert.ok(types.includes('tool-call-delta'));
  const reasoningBlockEnd = chunks.find((c) => c.type === 'block-end' && c.block.type === 'reasoning');
  assert.equal(reasoningBlockEnd.block.text, 'so far');
  const toolDelta = chunks.find((c) => c.type === 'tool-call-delta');
  assert.equal(toolDelta.id, 'toolu_1');
  assert.equal(toolDelta.name, 'read');
  const blockEnd = chunks.find((c) => c.type === 'block-end' && c.block.type === 'tool-call');
  assert.equal(blockEnd.block.arguments, '{"p":"x"}');
  const usage = chunks.find((c) => c.type === 'usage');
  assert.equal(usage.usage.inputTokens, 12);
  assert.equal(usage.usage.cacheReadTokens, 3);
  assert.equal(usage.usage.outputTokens, 33);
  const finish = chunks.at(-1);
  assert.deepEqual(finish, { type: 'finish', reason: { kind: 'tool-calls' } });
});

ok('translateAnthropic errors on truncation', async () => {
  const events = (async function* () {
    yield { event: 'message_start', data: JSON.stringify({ type: 'message_start', message: { usage: {} } }) };
  })();
  const chunks = [];
  let threw = false;
  try {
    for await (const chunk of translateAnthropic(events)) chunks.push(chunk);
  } catch {
    threw = true;
  }
  assert.ok(threw);
});

// ── 4b. Regressions ────────────────────────────────────────────────────────
ok('stream() reports the real failure, not a scope crash', async () => {
  // No OAuth session, no credentials service, no apiKeyEnv → resolveAuth throws
  // before the watchdog exists, which is exactly the path that used to hit a
  // `catch` reading a `let` declared inside the `try`.
  const adapter = new ClaudeAdapter({
    options: () => resolveAdapterOptions({}),
    getCredentials: () => undefined,
    getAttachments: () => undefined,
    launchEnvironment: undefined,
    resolveOAuthToken: async () => undefined,
    resolveUserId: () => 'test-user',
  });
  let caught;
  try {
    for await (const _chunk of adapter.stream({
      provider: 'claude-subscription',
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      throw new Error('expected no chunks');
    }
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== undefined, 'stream() should have thrown');
  assert.ok(!(caught instanceof ReferenceError), `scope bug regressed: ${caught.message}`);
  assert.equal(caught.code, 'MISSING_CREDENTIAL');
});

ok('parseSse keeps concurrent streams isolated', async () => {
  const encoder = new TextEncoder();
  const first = encoder.encode('data: {"t":"你好世界"}\n\n');
  const second = encoder.encode('data: {"t":"再见朋友"}\n\n');
  // Split mid-character: a decoder shared across streams bleeds the partial
  // sequence into whichever stream decodes next.
  const streamOf = (bytes) =>
    (async function* () {
      yield bytes.slice(0, 13);
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield bytes.slice(13);
    })();
  const collect = async (input) => {
    const out = [];
    for await (const event of parseSse(input)) out.push(event.data);
    return out;
  };
  const [a, b] = await Promise.all([collect(streamOf(first)), collect(streamOf(second))]);
  assert.deepEqual(a, ['{"t":"你好世界"}']);
  assert.deepEqual(b, ['{"t":"再见朋友"}']);
});

ok('thinking API is selected per model generation', async () => {
  const defaults = resolveAdapterOptions({});
  const thinkingType = async (model) => {
    const body = await serializeRequest(
      {
        provider: 'p',
        model,
        reasoningEffort: 'high',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      },
      defaults,
      noImages,
    );
    return body.thinking?.type;
  };
  for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-4-6']) {
    assert.equal(await thinkingType(model), 'adaptive', `${model} must use adaptive thinking`);
  }
  for (const model of ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-3-7-sonnet-20250219']) {
    assert.equal(await thinkingType(model), 'enabled', `${model} must use budget_tokens`);
  }
});

ok('adaptive models omit budget_tokens and temperature', async () => {
  const body = await serializeRequest(
    {
      provider: 'p',
      model: 'claude-opus-5',
      temperature: 0.7,
      reasoningEffort: 'max',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    },
    resolveAdapterOptions({}),
    noImages,
  );
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(body.output_config, { effort: 'max' });
  assert.equal(body.thinking.budget_tokens, undefined);
  assert.equal(body.temperature, undefined, 'sampling params are rejected on 4.6+');
});

ok('pre-4.6 models still accept temperature with thinking off', async () => {
  const body = await serializeRequest(
    {
      provider: 'p',
      model: 'claude-sonnet-4-5',
      temperature: 0.7,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    },
    resolveAdapterOptions({ thinking: 'disabled', reasoningEffort: 'off' }),
    noImages,
  );
  assert.equal(body.thinking, undefined);
  assert.equal(body.temperature, 0.7);
});

ok('default catalog ships no retired models', () => {
  const retired = new Set([
    'claude-opus-4-1',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ]);
  for (const model of DEFAULT_MODELS) {
    assert.ok(!retired.has(model.id), `${model.id} is retired and 404s`);
  }
});

// ── 5. OAuth helpers (no network) ──────────────────────────────────────────
ok('OAuthManager beginLogin builds a valid authorize URL', async () => {
  const manager = new OAuthManager();
  const urlText = await manager.beginLogin('flow-1');
  const url = new URL(urlText);
  assert.equal(url.origin, 'https://claude.com');
  assert.equal(url.pathname, '/cai/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'user:inference user:profile');
  const redirectUri = url.searchParams.get('redirect_uri');
  assert.ok(redirectUri.startsWith('http://localhost:'));
  assert.ok(redirectUri.endsWith('/callback'));
  assert.ok(url.searchParams.get('state').length > 0);
  assert.ok(url.searchParams.get('code_challenge').length > 0);
  manager.dispose();
});

await Promise.all(checks);
console.log(`\n${passed} checks passed`);

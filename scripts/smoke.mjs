/**
 * Smoke test: exercises the wire translation and config without any network
 * (except the fetchModels test, which mocks `fetch`).
 * Run: node scripts/smoke.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeRequest, serializeMessages, translateAnthropic, fetchModels } from '../lib/anthropic.js';
import { parseSse } from '../lib/sse.js';
import { buildTranscript, mapEvent } from '../lib/cc-console.js';
import { buildSdkOptions, mapSdkMessage } from '../lib/cc-sdk.js';
import { Config, resolveAdapterOptions, DEFAULT_MODELS } from '../lib/config.js';
import { AUTH_REF, LOGIN_REF, resolveSubscriptionToken, claudeCodeStatus } from '../lib/auth.js';

let passed = 0;
const checks = [];
// Deferred execution: tests run sequentially so global state (the `fetch`
// mock, temp files) cannot race between tests.
function ok(name, fn) {
  checks.push([name, fn]);
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
  assert.deepEqual(resolved.status, {});
  assert.deepEqual(resolved.refresh, {});
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
  // modern effort API: adaptive thinking + output_config.effort
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.deepEqual(body.output_config, { effort: 'high' });
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
  assert.equal(body.output_config, undefined);
});

ok('effort levels serialize through the config', async () => {
  for (const [effort, expected] of [
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'max'],
  ]) {
    const opts = resolveAdapterOptions({ reasoningEffort: effort });
    assert.equal(opts.defaults.reasoningEffort, effort);
    const body = await serializeRequest(
      { provider: 'p', model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], reasoningEffort: effort },
      opts,
      noImages,
    );
    assert.deepEqual(body.output_config, { effort: expected });
    assert.deepEqual(body.thinking, { type: 'adaptive' });
  }
  const off = await serializeRequest(
    { provider: 'p', model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], reasoningEffort: 'off' },
    resolveAdapterOptions({}),
    noImages,
  );
  assert.equal(off.thinking, undefined);
  assert.equal(off.output_config, undefined);
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

// ── 2b. Claude Code console transcript + event mapping ──────────────────────
ok('buildTranscript renders a role-tagged conversation', () => {
  const { args, stdin } = buildTranscript({
    model: 'claude-opus-5',
    system: 'you are a coding agent',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'reasoning', text: 'hidden' }] },
      { role: 'user', content: [{ type: 'text', text: 'next' }] },
    ],
  });
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--model'));
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5');
  assert.ok(args.includes('--dangerously-skip-permissions'));
  assert.ok(args.includes('--append-system-prompt'));
  assert.equal(args[args.indexOf('--append-system-prompt') + 1], 'you are a coding agent');
  assert.ok(stdin.includes('<user>\nhello\n</user>'));
  assert.ok(stdin.includes('<assistant>\nhi\n</assistant>'));
  // reasoning is dropped from the transcript
  assert.ok(!stdin.includes('hidden'));
  assert.ok(stdin.includes('<user>\nnext\n</user>'));
});

ok('buildTranscript omits the system prompt when unset (clean Claude persona)', () => {
  const { args } = buildTranscript({
    model: 'claude-opus-5',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  });
  assert.ok(!args.includes('--append-system-prompt'), 'no harness system prompt in console mode');
});

ok('mapEvent translates claude stream-json events', () => {
  const textChunks = mapEvent({
    type: 'assistant',
    message: { content: [
      { type: 'text', text: 'Sure' },
      { type: 'tool_use', id: 'x', name: 'Bash', input: {} },
    ] },
  });
  const kinds = textChunks.map((c) => c.type);
  assert.deepEqual(kinds, ['block-start', 'text-delta', 'block-end']);
  assert.equal(textChunks.find((c) => c.type === 'text-delta').text, 'Sure');
  // tool_use is not surfaced (Claude Code executes its own tools)

  const okChunks = mapEvent({
    type: 'result',
    is_error: false,
    usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 10 },
  });
  assert.deepEqual(okChunks.at(-1), { type: 'finish', reason: { kind: 'stop' } });
  const usage = okChunks.find((c) => c.type === 'usage');
  assert.equal(usage.usage.inputTokens, 5);
  assert.equal(usage.usage.cacheReadTokens, 10);

  const errorChunks = mapEvent({
    type: 'result',
    is_error: true,
    errors: ['No conversation found with session ID: x'],
  });
  assert.equal(errorChunks.at(-1).reason.kind, 'error');
  assert.ok(String(errorChunks.at(-1).reason.failure.message).includes('No conversation'));
});

ok('mapSdkMessage translates Claude Agent SDK messages', () => {
  const textChunks = mapSdkMessage({
    type: 'assistant',
    message: { content: [
      { type: 'text', text: 'done' },
      { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'x' } },
    ] },
  });
  assert.deepEqual(textChunks.map((c) => c.type), ['block-start', 'text-delta', 'block-end']);
  assert.equal(textChunks.find((c) => c.type === 'text-delta').text, 'done');

  const okChunks = mapSdkMessage({
    type: 'result',
    is_error: false,
    usage: { input_tokens: 2, output_tokens: 1 },
  });
  assert.deepEqual(okChunks.at(-1), { type: 'finish', reason: { kind: 'stop' } });

  const errorChunks = mapSdkMessage({ type: 'result', is_error: true, errors: ['boom'] });
  assert.equal(errorChunks.at(-1).reason.kind, 'error');
});

ok('buildSdkOptions forces every tool through the approval gate', async () => {
  const asks = [];
  let askCount = 0;
  const sdkOptions = buildSdkOptions(
    { model: 'claude-opus-5', messages: [] },
    {
      askUser: async (item) => {
        asks.push(item);
        askCount += 1;
        return { answers: [{ id: item.id, selected: [askCount === 1 ? '允许' : '拒绝'] }] };
      },
    },
  );
  assert.equal(sdkOptions.model, 'claude-opus-5');
  assert.ok(sdkOptions.settings.permissions.ask.includes('Bash'));
  assert.ok(sdkOptions.settings.permissions.ask.includes('Edit'));
  assert.equal(sdkOptions.settings.permissions.disableBypassPermissionsMode, 'disable');

  const allowed = await sdkOptions.canUseTool('Bash', { command: 'echo x' }, { toolUseID: 't1', requestId: 'r1' });
  assert.equal(allowed.behavior, 'allow');
  assert.equal(asks.length, 1);
  assert.ok(String(asks[0].question).length > 0);

  const denied = await sdkOptions.canUseTool('Edit', { file_path: 'a' }, { toolUseID: 't2', requestId: 'r2' });
  assert.equal(denied.behavior, 'deny');

  // Fail-closed: an unanswerable permission request denies the tool.
  const failed = await buildSdkOptions({ model: 'm', messages: [] }, { askUser: async () => { throw new Error('no UI'); } })
    .canUseTool('Bash', {}, { toolUseID: 't3', requestId: 'r3' });
  assert.equal(failed.behavior, 'deny');
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

ok('adapter stream surfaces the real transport error (no idleTimedOut ReferenceError)', async () => {
  const { ClaudeAdapter } = await import('../lib/adapter.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    headers: new Headers(),
    json: async () => ({ error: { message: 'boom' } }),
  });
  try {
    const adapter = new ClaudeAdapter({
      options: () => resolveAdapterOptions({}),
      resolveSubscriptionToken: async () => ({ kind: 'subscription', token: 'tok', source: 'pasted' }),
      getCredentials: () => undefined,
      getAttachments: () => undefined,
      launchEnvironment: undefined,
      resolveUserId: () => 'u',
    });
    let threw = null;
    try {
      for await (const _chunk of adapter.stream({
        provider: 'claude-subscription',
        model: 'claude-sonnet-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        // no chunks expected on a 500
      }
    } catch (error) {
      threw = error;
    }
    assert.ok(threw instanceof Error, 'expected an error from the 500 response');
    const message = String(threw?.message ?? threw);
    assert.ok(!/idleTimedOut is not defined/.test(message), 'must not be the scoping ReferenceError');
    assert.equal(threw.code, 'SERVER', 'should carry the mapped HTTP error code');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

ok('adapter distinguishes entitlement 429 from a genuine rate limit', async () => {
  const { ClaudeAdapter } = await import('../lib/adapter.js');
  const originalFetch = globalThis.fetch;
  const run = async (headers) => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      headers: new Headers(headers),
      json: async () => ({ error: { type: 'rate_limit_error', message: 'Error' } }),
    });
    const adapter = new ClaudeAdapter({
      options: () => resolveAdapterOptions({}),
      resolveSubscriptionToken: async () => ({ kind: 'subscription', token: 'tok', source: 'pasted' }),
      getCredentials: () => undefined,
      getAttachments: () => undefined,
      launchEnvironment: undefined,
      resolveUserId: () => 'u',
    });
    let threw = null;
    try {
      for await (const _c of adapter.stream({
        provider: 'claude-subscription',
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        // no chunks on 429
      }
    } catch (error) {
      threw = error;
    }
    assert.ok(threw instanceof Error, 'expected an error');
    return String(threw.message);
  };
  try {
    // No rate-limit headers → entitlement rejection.
    const entitlementMessage = await run({});
    assert.ok(/无权|entitlement/i.test(entitlementMessage) || /haiku/i.test(entitlementMessage), `entitlement wording expected, got: ${entitlementMessage}`);
    // With rate-limit headers → genuine rate limit.
    const rateLimitedMessage = await run({ 'anthropic-ratelimit-requests-remaining': '0' });
    assert.ok(/频繁|429/.test(rateLimitedMessage), `rate-limit wording expected, got: ${rateLimitedMessage}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

ok('adapter falls back to no-thinking when a model rejects adaptive thinking', async () => {
  const { ClaudeAdapter } = await import('../lib/adapter.js');
  const originalFetch = globalThis.fetch;
  const calls = [];
  const sseOk = () => {
    const text =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":0}}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    return { ok: true, status: 200, headers: new Headers(), body: stream };
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (calls.length === 1) {
      return {
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({ error: { type: 'invalid_request_error', message: 'adaptive thinking is not supported on this model' } }),
      };
    }
    return sseOk();
  };
  try {
    const adapter = new ClaudeAdapter({
      options: () => resolveAdapterOptions({}),
      resolveSubscriptionToken: async () => ({ kind: 'subscription', token: 'tok', source: 'pasted' }),
      getCredentials: () => undefined,
      getAttachments: () => undefined,
      launchEnvironment: undefined,
      resolveUserId: () => 'u',
    });
    const chunks = [];
    for await (const chunk of adapter.stream({
      provider: 'claude-subscription',
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      chunks.push(chunk.type);
    }
    assert.equal(calls.length, 2, 'should retry once without thinking');
    assert.deepEqual(calls[0].body.output_config, { effort: 'high' }, 'first attempt uses the effort API');
    assert.equal(calls[1].body.output_config, undefined, 'fallback drops output_config');
    assert.equal(calls[1].body.thinking, undefined, 'fallback drops thinking');
    assert.ok(chunks.includes('finish'), 'the fallback stream completes');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── 5. Subscription token sources (temp file + mocked credentials) ─────────
const tmpDir = await mkdtemp(join(tmpdir(), 'dsh-claude-smoke-'));
const filePath = join(tmpDir, '.credentials.json');

function credentialsStub(store) {
  return {
    async resolve(ref) {
      const value = store[String(ref)];
      return value === undefined ? undefined : { value, source: 'test' };
    },
    async set(ref, value) {
      store[String(ref)] = value;
    },
    async unset(ref) {
      delete store[String(ref)];
    },
  };
}

const loginFixture = {
  claudeAiOauth: {
    accessToken: 'file-token-live',
    refreshToken: 'file-refresh',
    expiresAt: Date.now() + 3600_000,
    subscriptionType: 'max',
    rateLimitTier: 'standard',
    scopes: ['user:profile', 'user:inference'],
  },
};

ok('resolveSubscriptionToken prefers the pasted token', async () => {
  const f = join(tmpDir, 'a.json');
  await writeFile(f, JSON.stringify(loginFixture), 'utf8');
  const store = { [String(AUTH_REF)]: 'pasted-token' };
  const result = await resolveSubscriptionToken(credentialsStub(store), f);
  assert.deepEqual(result, { kind: 'subscription', token: 'pasted-token', source: 'pasted' });
});

ok('resolveSubscriptionToken falls back to the live login file', async () => {
  const f = join(tmpDir, 'b.json');
  await writeFile(f, JSON.stringify(loginFixture), 'utf8');
  const result = await resolveSubscriptionToken(credentialsStub({}), f);
  assert.equal(result.kind, 'subscription');
  assert.equal(result.token, 'file-token-live');
  assert.equal(result.source, 'claude-code');
});

ok('resolveSubscriptionToken refreshes an expired file token (rotation-safe)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://platform.claude.com/v1/oauth/token');
    const body = JSON.parse(options.body);
    assert.equal(body.grant_type, 'refresh_token');
    assert.equal(body.refresh_token, 'file-refresh');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'refreshed-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }),
    };
  };
  try {
    const f = join(tmpDir, 'c.json');
    await writeFile(
      f,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'file-token-expired',
          refreshToken: 'file-refresh',
          expiresAt: Date.now() - 60_000,
        },
      }),
      'utf8',
    );
    const store = {};
    const result = await resolveSubscriptionToken(credentialsStub(store), f);
    assert.equal(result.token, 'refreshed-token');
    // rotation-safe: the new refresh token is cached in our seam...
    const envelope = JSON.parse(store[String(LOGIN_REF)]);
    assert.equal(envelope.accessToken, 'refreshed-token');
    assert.equal(envelope.refreshToken, 'new-refresh-token');
    // ...and written back to the Claude Code file.
    const written = JSON.parse(await readFile(f, 'utf8'));
    assert.equal(written.claudeAiOauth.accessToken, 'refreshed-token');
    assert.equal(written.claudeAiOauth.refreshToken, 'new-refresh-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

ok('claudeCodeStatus reports the login facts', async () => {
  const f = join(tmpDir, 'd.json');
  await writeFile(f, JSON.stringify(loginFixture), 'utf8');
  const status = await claudeCodeStatus(f);
  assert.equal(status.source, 'claude-code');
  assert.equal(status.subscriptionType, 'max');
  assert.equal(status.rateLimitTier, 'standard');
  assert.ok(status.account.length > 0 || status.account === '');
});

ok('claudeCodeStatus is undefined without a login file', async () => {
  const status = await claudeCodeStatus(join(tmpDir, 'missing.json'));
  assert.equal(status, undefined);
});

for (const [name, fn] of checks) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
await rm(tmpDir, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);

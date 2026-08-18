/**
 * Boot test for the host plugin: imports the real module (validating every
 * @deepseek-ai import resolves), then drives `apply` with stub services to
 * verify provider/adapter registration and the settings handshake wiring.
 * Run: node scripts/host-boot-test.mjs
 */
import assert from 'node:assert/strict';
import { apply, name, inject } from '../lib/index.js';
import { PROVIDER, NS } from '../lib/config.js';

assert.equal(name, 'llm-claude');
assert.deepEqual(inject, ['llm']);

const events = [];
const calls = [];

const llmStub = {
  registerConfigurableProviders(entries) {
    calls.push(['registerConfigurableProviders', entries]);
  },
  registerAdapter(providers, adapter) {
    calls.push(['registerAdapter', providers, adapter]);
    return {
      replace(next) {
        calls.push(['replace', next]);
      },
    };
  },
};

const settingsStub = {
  register(ns, schema, options) {
    calls.push(['settings.register', ns, options]);
    return {
      get: () => ({
        thinking: 'enabled',
        reasoningEffort: 'high',
        models: undefined,
        baseURL: undefined,
        apiKeyEnv: undefined,
        retryPolicy: undefined,
      }),
      watch: () => () => {},
      update: async () => {},
      replace: async () => {},
    };
  },
  mutate: async () => {},
};

const credentialsStub = {
  resolve: async () => undefined,
  set: async () => {},
  unset: async () => {},
  describe: async () => ({ configured: false, writable: true }),
};

const ctx = {
  get(name) {
    if (name === 'settings') return settingsStub;
    if (name === 'credentials') return credentialsStub;
    return undefined;
  },
  llm: llmStub,
  effect(fn) {
    const disposer = fn();
    if (typeof disposer === 'function') disposer();
    events.push('effect');
  },
  logger: { error() {} },
  on() {},
};

apply(ctx, {});

const providerReg = calls.find((c) => c[0] === 'registerConfigurableProviders');
assert.ok(providerReg !== undefined, 'registerConfigurableProviders not called');
assert.equal(providerReg[1][0].provider, PROVIDER);
assert.equal(providerReg[1][0].settingsNs, NS);
assert.equal(providerReg[1][0].settingsPath.length, 0);

const adapterReg = calls.find((c) => c[0] === 'registerAdapter');
assert.ok(adapterReg !== undefined, 'registerAdapter not called');
assert.deepEqual(adapterReg[1], [PROVIDER]);
const adapter = adapterReg[2];

// adapter surface
assert.equal(adapter.providerInfo(PROVIDER).id, PROVIDER);
assert.ok(Array.isArray(await adapter.listModels(PROVIDER)));
assert.ok((await adapter.listModels(PROVIDER)).length > 0);
const resolved = await adapter.resolveModel(PROVIDER, 'claude-sonnet-4-5');
assert.equal(resolved.provider, PROVIDER);
assert.equal(resolved.context.contextWindow, 200000);
assert.ok(Array.isArray(resolved.reasoning.efforts));

console.log('host plugin boot test passed');

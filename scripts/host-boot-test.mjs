/**
 * Boot test for the host plugin: imports the real module (validating every
 * @deepseek-ai import resolves), then drives `apply` with stub services to
 * verify provider/adapter registration and the REACTIVE settings wiring
 * (`ctx.inject(['settings'])` — the fix for the "namespace not registered"
 * race where `llm` is ready before `settings`).
 * Run: node scripts/host-boot-test.mjs
 */
import assert from 'node:assert/strict';
import { apply, name, inject } from '../lib/index.js';
import { PROVIDER, NS } from '../lib/config.js';

assert.equal(name, 'llm-claude');
assert.deepEqual(inject, ['llm']);

const calls = [];
const injectedKeys = [];

const scopeStub = {
  get: () => ({ thinking: 'enabled', reasoningEffort: 'high' }),
  watch: () => {
    calls.push(['scope.watch']);
    return () => {};
  },
  update: async () => {},
  replace: async () => {},
};

const settingsStub = {
  register(ns, schema, options) {
    calls.push(['settings.register', ns, options?.base]);
    return scopeStub;
  },
  mutate: async () => {},
};

const credentialsStub = {
  resolve: async () => undefined,
  set: async () => {},
  unset: async () => {},
  describe: async () => ({ configured: false, writable: true }),
};

const llmStub = {
  registerConfigurableProviders(entries) {
    calls.push(['registerConfigurableProviders', entries]);
  },
  registerAdapter(providers, adapter) {
    calls.push(['registerAdapter', providers, adapter]);
    return { replace(next) { calls.push(['replace', next]); } };
  },
  registerModelDiscovery(ns, discover) {
    calls.push(['registerModelDiscovery', ns, discover]);
  },
};

let injectDisposer = null;
const subEffects = [];
const ctx = {
  get(name) {
    if (name === 'credentials') return credentialsStub;
    return undefined;
  },
  llm: llmStub,
  inject(keys, callback) {
    injectedKeys.push(keys);
    // Simulate the settings service already being available.
    const sub = {
      settings: settingsStub,
      get: (n) => (n === 'credentials' ? credentialsStub : undefined),
      effect(fn) {
        const disposer = fn();
        subEffects.push(disposer);
        if (typeof disposer === 'function') disposer();
      },
    };
    injectDisposer = callback(sub);
  },
  effect(fn) {
    const disposer = fn();
    if (typeof disposer === 'function') disposer();
  },
  logger: { error() {} },
  on() {},
};

apply(ctx, {});

// The plugin must register through the reactive inject, not a one-shot get.
assert.ok(
  injectedKeys.some((keys) => keys.length === 1 && keys[0] === 'settings'),
  'ctx.inject(["settings"]) was not used',
);

const providerReg = calls.find((c) => c[0] === 'registerConfigurableProviders');
assert.ok(providerReg !== undefined, 'registerConfigurableProviders not called');
assert.equal(providerReg[1][0].provider, PROVIDER);
assert.equal(providerReg[1][0].settingsNs, NS);
assert.equal(providerReg[1][0].settingsPath.length, 0);

const nsReg = calls.find((c) => c[0] === 'settings.register');
assert.ok(nsReg !== undefined, 'settings.register not called');
assert.equal(nsReg[1], NS);
assert.deepEqual(nsReg[2], {}); // composition entry config as base layer

// One watcher: the retry-policy re-registration. The OAuth handshake watcher
// went away with the flow itself.
assert.ok(calls.filter((c) => c[0] === 'scope.watch').length >= 1, 'namespace watcher registered');

const discoveryReg = calls.find((c) => c[0] === 'registerModelDiscovery');
assert.ok(discoveryReg !== undefined, 'registerModelDiscovery not called');
assert.equal(discoveryReg[1], NS);
assert.equal(typeof discoveryReg[2], 'function');

const adapterReg = calls.find((c) => c[0] === 'registerAdapter');
assert.ok(adapterReg !== undefined, 'registerAdapter not called');
assert.deepEqual(adapterReg[1], [PROVIDER]);
const adapter = adapterReg[2];

// adapter surface
assert.equal(adapter.providerInfo(PROVIDER).id, PROVIDER);
const models = await adapter.listModels(PROVIDER);
assert.ok(Array.isArray(models) && models.length > 0);
assert.deepEqual(models[0].inputModalities, ['text', 'image']);
const resolved = await adapter.resolveModel(PROVIDER, 'claude-sonnet-4-5');
assert.equal(resolved.provider, PROVIDER);
assert.equal(resolved.context.contextWindow, 200000);
assert.ok(Array.isArray(resolved.reasoning.efforts));
assert.deepEqual(resolved.inputModalities, ['text', 'image']);

// The inject disposer must restore the entry-only source (no crash).
assert.equal(injectDisposer, undefined); // the callback registers cleanup via sctx.effect
assert.ok(subEffects.length >= 1, 'sub-context effects registered');
for (const disposer of subEffects) {
  if (typeof disposer === 'function') disposer();
}

console.log('host plugin boot test passed');

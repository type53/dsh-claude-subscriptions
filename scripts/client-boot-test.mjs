/**
 * Boot test for the browser bundle: simulates the module loader, calls the
 * factory with a stub `require`, and drives `apply` with a stub ctx to verify
 * the settings.section registration fires.
 * Run: node scripts/client-boot-test.mjs
 */
import assert from 'node:assert/strict';

let loadedDef;
globalThis.window = {
  __ModuleLoader__: {
    load: (def) => {
      loadedDef = def;
    },
  },
};

await import('../lib/client.js');
assert.ok(loadedDef !== undefined, 'client bundle did not call __ModuleLoader__.load');
assert.equal(loadedDef.id, 'dsh-claude-subscriptions');

const reactStub = {
  createElement: (...args) => ({ __vnode: true, args }),
  Fragment: Symbol('fragment'),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
};

const registrations = [];
const ctx = {
  effect: (fn) => {
    const disposer = fn();
    if (typeof disposer === 'function') disposer();
  },
  get: (name) => (name === 'connection' ? { api: {}, isLoopback: true } : undefined),
  locale: {
    register: () => {},
    bind: () => (key) => key,
  },
  slots: {
    inject: (name, fn) => {
      if (name !== 'settings.section') return;
      const registration = fn();
      if (registration !== undefined) registrations.push(registration);
    },
    register: (opts) => opts,
  },
  remote: { $on: () => () => {} },
};

const mod = loadedDef.factory((spec) => {
  if (spec === 'react') return reactStub;
  throw new Error(`unexpected require: ${spec}`);
});

assert.ok(typeof mod.apply === 'function', 'apply missing');
assert.ok(Array.isArray(mod.inject), 'inject missing');
assert.deepEqual(mod.inject, ['slots', 'locale', 'connection', 'remote']);

mod.apply(ctx);
assert.equal(registrations.length, 1, 'settings.section registration count');
const section = registrations[0];
assert.equal(section.name, 'settings.section');
assert.equal(section.id, 'claude-subscriptions');
assert.equal(section.label(), 'nav'); // locale stub returns the key itself
assert.equal(typeof section.inject, 'function');

console.log('client bundle boot test passed');

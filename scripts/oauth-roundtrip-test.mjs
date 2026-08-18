/**
 * OAuth round-trip test: exercises the loopback callback server end-to-end
 * with the platform.claude.com token endpoint mocked out.
 * Run: node scripts/oauth-roundtrip-test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { OAuthManager } from '../lib/oauth.js';

let tokenCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://platform.claude.com/v1/oauth/token') {
    tokenCalls += 1;
    const body = JSON.parse(options.body);
    assert.equal(body.grant_type, 'authorization_code');
    assert.equal(body.client_id, '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    assert.ok(body.code_verifier.length > 0);
    assert.ok(body.redirect_uri.endsWith('/callback'));
    assert.equal(body.expires_in, 31536000);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'jwt.access.token',
        refresh_token: 'refresh-token-1',
        expires_in: 31536000,
        organization_id: 'org-123',
      }),
    };
  }
  throw new Error(`unexpected fetch: ${url}`);
};

const manager = new OAuthManager();
const urlText = await manager.beginLogin('flow-roundtrip');
const url = new URL(urlText);
const state = url.searchParams.get('state');

// Simulate the browser hitting the redirect URI after authorize. The server
// binds 127.0.0.1; resolve `localhost` to it so the request reaches the IPv4
// listener directly.
const redirectUri = url.searchParams.get('redirect_uri');
const callbackUrl = new URL(redirectUri);
callbackUrl.hostname = '127.0.0.1';
callbackUrl.searchParams.set('code', 'the-auth-code');
callbackUrl.searchParams.set('state', state);

const completion = manager.awaitLogin('flow-roundtrip');
const status = await new Promise((resolve, reject) => {
  http.get(callbackUrl, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});
assert.equal(status, 200);

const tokenResponse = await completion;
assert.equal(tokenResponse.access_token, 'jwt.access.token');
assert.equal(tokenResponse.refresh_token, 'refresh-token-1');
assert.equal(tokenResponse.organization_id, 'org-123');
assert.equal(tokenCalls, 1, 'exactly one token exchange');
// A completed login is no longer pending.
assert.equal(manager.pendingByFlow.has('flow-roundtrip'), false);
assert.equal(manager.pendingByState.has(state), false);

// Cancel path: a fresh flow, cancelled before the callback, rejects.
const cancelledUrl = new URL(await manager.beginLogin('flow-cancel'));
const cancelledState = cancelledUrl.searchParams.get('state');
const cancelPromise = manager.awaitLogin('flow-cancel');
manager.cancelLogin('flow-cancel');
await assert.rejects(cancelPromise, /已取消/);
assert.equal(manager.pendingByState.has(cancelledState), false);

manager.dispose();
globalThis.fetch = originalFetch;
console.log('oauth round-trip test passed');

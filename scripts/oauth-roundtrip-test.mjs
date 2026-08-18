/**
 * OAuth round-trip test: exercises the loopback callback server end-to-end
 * with the platform.claude.com token endpoint mocked out. Covers both a
 * straight success and the claude.com multi-step flow where a premature
 * callback (verification code not yet confirmed) must NOT complete the login.
 * Run: node scripts/oauth-roundtrip-test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { OAuthManager } from '../lib/oauth.js';

const originalFetch = globalThis.fetch;
let tokenCalls = 0;

function installFetchMock() {
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://platform.claude.com/v1/oauth/token') {
      tokenCalls += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.grant_type, 'authorization_code');
      assert.equal(body.client_id, '9d1c250a-e61b-44d9-88ed-5944d1962f5e');
      assert.ok(body.code_verifier.length > 0);
      assert.ok(body.redirect_uri.endsWith('/callback'));
      assert.equal(body.expires_in, 31536000);
      // A premature code (verification not confirmed) yields a token that the
      // verify gate rejects; the final code yields a fully active token.
      const premature = body.code === 'premature-code';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: premature ? 'premature-token' : 'final-token',
          refresh_token: premature ? 'premature-refresh' : 'final-refresh',
          expires_in: 31536000,
          organization_id: 'org-123',
          scope: premature ? 'user:profile' : 'user:inference user:profile',
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

function fireCallback(callbackUrl) {
  return new Promise((resolve, reject) => {
    http
      .get(callbackUrl, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });
}

function callbackUrlFor(manager, state, code) {
  const redirectUri = `http://localhost:${manager.port}/callback`;
  const url = new URL(redirectUri);
  url.hostname = '127.0.0.1'; // the server binds IPv4 loopback
  url.searchParams.set('code', code);
  url.searchParams.set('state', state);
  return url;
}

// ── straight success ───────────────────────────────────────────────────────
installFetchMock();
{
  const manager = new OAuthManager({ verifyToken: async () => true });
  const urlText = await manager.beginLogin('flow-simple');
  const state = new URL(urlText).searchParams.get('state');
  const completion = manager.awaitLogin('flow-simple');
  const status = await fireCallback(callbackUrlFor(manager, state, 'final-code'));
  assert.equal(status, 200);
  const tokenResponse = await completion;
  assert.equal(tokenResponse.access_token, 'final-token');
  assert.equal(manager.pendingByFlow.has('flow-simple'), false);
  manager.dispose();
}

// ── multi-step flow: premature callback must not complete ──────────────────
tokenCalls = 0;
{
  const manager = new OAuthManager({
    verifyToken: async (tokenResponse) => tokenResponse.access_token === 'final-token',
  });
  const urlText = await manager.beginLogin('flow-steps');
  const state = new URL(urlText).searchParams.get('state');
  const completion = manager.awaitLogin('flow-steps');

  // First callback arrives after the magic-link confirm, before the
  // verification code is entered: the exchanged token is not yet active.
  const prematureStatus = await fireCallback(callbackUrlFor(manager, state, 'premature-code'));
  assert.equal(prematureStatus, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(manager.pendingByFlow.has('flow-steps'), true, 'login must stay pending');
  assert.equal(manager.pendingByState.has(state), true, 'state must stay registered');

  // The user enters the verification code; the real callback completes.
  const finalStatus = await fireCallback(callbackUrlFor(manager, state, 'final-code'));
  assert.equal(finalStatus, 200);
  const tokenResponse = await completion;
  assert.equal(tokenResponse.access_token, 'final-token');
  assert.equal(manager.pendingByFlow.has('flow-steps'), false);
  manager.dispose();
}

// ── cancel path: a fresh flow, cancelled before the callback, rejects ──────
{
  const manager = new OAuthManager({ verifyToken: async () => true });
  const cancelledUrl = new URL(await manager.beginLogin('flow-cancel'));
  const cancelledState = cancelledUrl.searchParams.get('state');
  const cancelPromise = manager.awaitLogin('flow-cancel');
  manager.cancelLogin('flow-cancel');
  await assert.rejects(cancelPromise, /已取消/);
  assert.equal(manager.pendingByState.has(cancelledState), false);
  manager.dispose();
}

globalThis.fetch = originalFetch;
console.log('oauth round-trip test passed');

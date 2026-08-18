/**
 * Claude subscription OAuth (PKCE), mirroring the flow Claude Code uses:
 * authorize at claude.ai, exchange the code on a loopback callback server,
 * keep the tokens in the credentials seam, refresh access tokens, and fall
 * back to the Anthropic token-exchange endpoint for API access when the
 * direct bearer path is rejected.
 *
 * @module dsh-claude-subscriptions/oauth
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

/** Credential references this plugin owns (secrets never touch settings). */
export const REF_ACCESS = credentialRef('CLAUDE_OAUTH_ACCESS_TOKEN');
export const REF_REFRESH = credentialRef('CLAUDE_OAUTH_REFRESH_TOKEN');

/** The OAuth client id the claude.ai authorize server knows for Claude Code. */
const OAUTH_CLIENT_ID = 'claude-code-cli';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://claude.ai/oauth/token';
const API_TOKEN_EXCHANGE_URL = 'https://api.anthropic.com/v1/oauth/token';

/** Callback server lifetime: one ephemeral server per plugin instance. */
const CALLBACK_PATH = '/';

/** Minimum headroom (ms) kept before an access token is considered expired. */
const EXPIRY_MARGIN_MS = 60_000;

/** Generate a PKCE code verifier (43 chars, RFC 7636 charset). */
function generateVerifier() {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 43);
}

/** Derive the S256 challenge for a verifier. */
function challengeOf(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Decode a JWT payload without signature verification (claims only). */
function jwtClaims(token) {
  try {
    const part = token.split('.')[1];
    if (part === undefined) return {};
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

/** Best-effort human account label from a token response. */
function accountLabel(tokenResponse) {
  const organizationId = typeof tokenResponse.organization_id === 'string' ? tokenResponse.organization_id : '';
  let email = '';
  try {
    const claims = jwtClaims(tokenResponse.access_token);
    email = typeof claims.email === 'string' ? claims.email : typeof claims.sub === 'string' ? claims.sub : '';
  } catch {
    // token not a JWT — leave email empty
  }
  return { account: email.length > 0 ? email : 'claude.ai 账号', organizationId };
}

/** JSON envelope stored under REF_ACCESS. */
function accessEnvelope(accessToken, expiresIn) {
  return JSON.stringify({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000 - EXPIRY_MARGIN_MS,
  });
}

/** One in-flight login, keyed by flowId (browser) and state (callback). */
class PendingLogin {
  constructor(flowId, state, verifier) {
    this.flowId = flowId;
    this.state = state;
    this.verifier = verifier;
    this.url = undefined;
    this.promise = undefined;
    this.resolve = () => {};
    this.reject = () => {};
  }
}

/**
 * Owns the loopback callback server and the OAuth token lifecycle. One
 * instance per plugin fiber; disposing it closes the server and rejects any
 * in-flight login.
 */
export class OAuthManager {
  constructor() {
    this.server = undefined;
    this.port = undefined;
    this.pendingByState = new Map();
    this.pendingByFlow = new Map();
  }

  /** Start the loopback callback server (idempotent). */
  listen() {
    if (this.readyPromise !== undefined) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleCallback(req, res).catch((error) => {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`登录失败: ${error.message}`);
        });
      });
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
    return this.readyPromise;
  }

  /** Dispose the server and reject every pending login. */
  dispose() {
    for (const pending of this.pendingByState.values()) {
      // Settle the promise with a no-op handler attached: the handshake's
      // catch already observes the rejection; this prevents unhandled noise.
      if (pending.promise !== undefined) pending.promise.catch(() => {});
      pending.reject(new Error('登录流程已取消（插件停止）'));
    }
    this.pendingByState.clear();
    this.pendingByFlow.clear();
    if (this.server !== undefined) {
      this.server.close();
      this.server = undefined;
    }
    this.readyPromise = undefined;
    this.port = undefined;
  }

  /**
   * Begin a login for one flowId. Generates the PKCE pair and the authorize
   * URL; the caller writes `{ flowId, url, startedAt }` back to settings for
   * the browser to open.
   * @param flowId - browser-generated correlation id.
   * @returns the authorize URL to open.
   */
  async beginLogin(flowId) {
    await this.listen();
    if (this.pendingByFlow.has(flowId)) return this.pendingByFlow.get(flowId).url;
    const state = randomBytes(16).toString('hex');
    const verifier = generateVerifier();
    const challenge = challengeOf(verifier);
    const redirectUri = `http://127.0.0.1:${this.port}${CALLBACK_PATH}`;
    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', OAUTH_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'user:profile anthropic:api-access');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Create the promise eagerly so a callback that fires before the caller
    // awaits never drops the outcome.
    const pending = new PendingLogin(flowId, state, verifier);
    pending.url = url.toString();
    pending.promise = new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    this.pendingByState.set(state, pending);
    this.pendingByFlow.set(flowId, pending);
    return pending.url;
  }

  /**
   * Wait for the browser to complete one login (resolves with the raw token
   * response). The caller stores the tokens through the credentials seam.
   * @param flowId - the flow whose completion to await.
   */
  awaitLogin(flowId) {
    const existing = this.pendingByFlow.get(flowId);
    return existing === undefined ? undefined : existing.promise;
  }

  /** Cancel one in-flight login (browser aborted). */
  cancelLogin(flowId) {
    const pending = this.pendingByFlow.get(flowId);
    if (pending === undefined) return;
    this.pendingByState.delete(pending.state);
    this.pendingByFlow.delete(flowId);
    if (pending.promise !== undefined) pending.reject(new Error('登录已取消'));
  }

  /** Handle the loopback callback: exchange the code, resolve the pending login. */
  async handleCallback(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code');
    const pending = this.pendingByState.get(state);
    if (pending === undefined) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('未知的登录状态，请关闭窗口后重试');
      return;
    }
    if (url.searchParams.get('error') !== null) {
      this.finish(pending, { error: `授权被拒绝: ${url.searchParams.get('error_description') ?? url.searchParams.get('error')}` });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><p>授权未完成，可以关闭此窗口。</p></body></html>');
      return;
    }
    if (code === null) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('缺少授权码');
      return;
    }
    try {
      const redirectUri = `http://127.0.0.1:${this.port}${CALLBACK_PATH}`;
      const tokenResponse = await exchangeCode(code, redirectUri, pending.verifier);
      this.finish(pending, { tokenResponse });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><p style="font-family:sans-serif">登录成功！可以关闭此窗口并返回 dsh web。</p></body></html>');
    } catch (error) {
      this.finish(pending, { error: error.message });
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`登录失败: ${error.message}`);
    }
  }

  finish(pending, outcome) {
    this.pendingByState.delete(pending.state);
    this.pendingByFlow.delete(pending.flowId);
    if (pending.promise === undefined) return;
    if (outcome.error !== undefined) pending.reject(new Error(outcome.error));
    else pending.resolve(outcome.tokenResponse);
  }
}

/** Exchange an authorization code for tokens at the claude.ai token endpoint. */
async function exchangeCode(code, redirectUri, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: OAUTH_CLIENT_ID,
    code_verifier: verifier,
  });
  return tokenRequest(body);
}

/** Refresh an access token with the refresh grant. */
export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
  });
  return tokenRequest(body);
}

/** POST one form-encoded OAuth request and parse the JSON response. */
async function tokenRequest(body) {
  let response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (error) {
    throw new Error(`无法连接 claude.ai OAuth 服务: ${error.message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = data.error_description ?? data.error ?? `HTTP ${response.status}`;
    throw new Error(`OAuth 令牌交换失败: ${description}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('OAuth 响应缺少 access_token');
  }
  return data;
}

/**
 * Exchange a subscription access token for a short-lived API key (the
 * Anthropic "token exchange" flow). Returns the api key or undefined when the
 * endpoint rejects (older tokens / region), so callers can fall back to the
 * direct bearer path.
 */
export async function exchangeForApiKey(accessToken) {
  let response;
  try {
    response = await fetch(API_TOKEN_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: OAUTH_CLIENT_ID,
        subject_token: accessToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:api_key',
      }),
    });
  } catch (error) {
    return undefined;
  }
  if (!response.ok) return undefined;
  const data = await response.json().catch(() => ({}));
  return typeof data.access_token === 'string' && data.access_token.length > 0 ? data.access_token : undefined;
}

/**
 * Read the stored OAuth credentials and return a usable access token,
 * refreshing first when the stored one has expired.
 * @param credentials - the credentials seam.
 * @returns `{ accessToken, account, organizationId }`.
 */
export async function resolveOAuthToken(credentials) {
  const accessHit = await credentials.resolve(REF_ACCESS);
  const refreshHit = await credentials.resolve(REF_REFRESH);
  if (accessHit === undefined) throw new Error('尚未连接 Claude 订阅，请先在 设置 → 订阅 中完成登录');
  let envelope;
  try {
    envelope = JSON.parse(accessHit.value);
  } catch {
    envelope = { accessToken: accessHit.value, expiresAt: 0 };
  }
  if (typeof envelope.accessToken === 'string' && envelope.accessToken.length > 0 && envelope.expiresAt > Date.now()) {
    return { accessToken: envelope.accessToken };
  }
  if (refreshHit === undefined) throw new Error('Claude 订阅登录已过期，请重新登录');
  const refreshed = await refreshAccessToken(refreshHit.value);
  const nextAccess = accessEnvelope(refreshed.access_token, refreshed.expires_in ?? 1800);
  await credentials.set(REF_ACCESS, nextAccess);
  if (typeof refreshed.refresh_token === 'string' && refreshed.refresh_token.length > 0) {
    await credentials.set(REF_REFRESH, refreshed.refresh_token);
  }
  return { accessToken: refreshed.access_token };
}

/** Build the credentials writes for a fresh token response. */
export async function storeTokenResponse(credentials, tokenResponse) {
  const access = accessEnvelope(tokenResponse.access_token, tokenResponse.expires_in ?? 1800);
  await credentials.set(REF_ACCESS, access);
  if (typeof tokenResponse.refresh_token === 'string' && tokenResponse.refresh_token.length > 0) {
    await credentials.set(REF_REFRESH, tokenResponse.refresh_token);
  }
  return accountLabel(tokenResponse);
}

/** Remove every OAuth credential this plugin owns. */
export async function clearOAuthCredentials(credentials) {
  await credentials.unset(REF_ACCESS);
  await credentials.unset(REF_REFRESH);
}

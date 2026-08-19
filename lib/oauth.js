/**
 * Claude subscription OAuth (PKCE), mirroring the exact flow Claude Code v2.x
 * uses (verified from the shipped binary): authorize at claude.com, exchange
 * the code against the platform token endpoint, and keep the tokens in the
 * credentials seam.
 *
 * @module dsh-claude-subscriptions/oauth
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

/** Credential references this plugin owns (secrets never touch settings). */
export const REF_ACCESS = credentialRef('CLAUDE_OAUTH_ACCESS_TOKEN');
export const REF_REFRESH = credentialRef('CLAUDE_OAUTH_REFRESH_TOKEN');

/**
 * OAuth endpoints and identity copied from Claude Code v2.1.234's shipped
 * config (`mYc` in the native bundle). The client id is a UUID, the authorize
 * endpoint moved to claude.com, and the token endpoint to platform.claude.com.
 */
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_SCOPES = 'user:inference user:profile';

/** Token lifetime Claude Code requests (one year), in seconds. */
const TOKEN_LIFETIME_SECONDS = 31536000;

/** Callback server path; Claude Code uses `http://localhost:<port>/callback`. */
const CALLBACK_PATH = '/callback';

/** Minimum headroom (ms) kept before an access token is considered expired. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * How long one login may stay in flight before the host abandons it. Matches
 * the browser half's own timeout; without it a login the user walks away from
 * pins its pending entry and its `flow` scratchpad forever.
 */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

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
    this.timer = undefined;
    /** Last exchange failure, surfaced if this login later times out. */
    this.lastError = undefined;
  }

  /** Stop the abandonment timer, if one is armed. */
  disarm() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

/**
 * Owns the loopback callback server and the OAuth token lifecycle. One
 * instance per plugin fiber; disposing it closes the server and rejects any
 * in-flight login.
 *
 * claude.com's login is a multi-step flow (email magic link → confirm →
 * verification code). Intermediate steps may redirect to the callback with a
 * code whose token is NOT yet active, so a login only completes after the
 * token passes {@link deps.verifyToken}.
 */
export class OAuthManager {
  constructor(deps = {}) {
    this.deps = deps;
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
      pending.disarm();
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
    const redirectUri = `http://localhost:${this.port}${CALLBACK_PATH}`;
    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', OAUTH_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', OAUTH_SCOPES);
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
    pending.timer = setTimeout(() => {
      const detail = pending.lastError === undefined ? '' : `（最后一次错误：${pending.lastError}）`;
      this.finish(pending, { error: `登录超时，请重试${detail}` });
    }, LOGIN_TIMEOUT_MS);
    if (pending.timer.unref !== undefined) pending.timer.unref();
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
    pending.disarm();
    this.pendingByState.delete(pending.state);
    this.pendingByFlow.delete(flowId);
    if (pending.promise !== undefined) pending.reject(new Error('登录已取消'));
  }

  /**
   * Handle the loopback callback. Only the `/callback` path is processed;
   * intermediate steps of claude.com's magic-link + verification-code flow may
   * hit the server first, so a login completes ONLY once the exchanged token
   * passes `deps.verifyToken`. Non-final callbacks keep the pending alive.
   */
  async handleCallback(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      // Intermediate navigation — do not disturb the pending login.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><p>请返回 Claude 页面完成登录步骤。</p></body></html>');
      return;
    }
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') !== null) {
      const pending = this.findPending(state);
      if (pending !== undefined) {
        this.finish(pending, { error: `授权被拒绝: ${url.searchParams.get('error_description') ?? url.searchParams.get('error')}` });
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><p>授权未完成，可以关闭此窗口。</p></body></html>');
      return;
    }
    if (code === null) {
      // No code yet: the browser is still mid-flow (email / verification).
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><p>请完成 Claude 页面上的登录步骤后重试。</p></body></html>');
      return;
    }
    const pending = this.findPending(state);
    if (pending === undefined) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><p>未知的登录状态，可以关闭此窗口。</p></body></html>');
      return;
    }
    try {
      const redirectUri = `http://localhost:${this.port}${CALLBACK_PATH}`;
      const tokenResponse = await exchangeCode(code, redirectUri, pending.verifier, pending.state);
      const verified = this.deps.verifyToken === undefined ? true : await this.deps.verifyToken(tokenResponse);
      if (verified !== true) {
        // Token issued but not yet active (verification code not confirmed):
        // keep the pending alive and let the final callback complete it.
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body><p style="font-family:sans-serif">登录尚未完成：请在 Claude 页面输入验证码完成认证后，回到 dsh web 等待连接成功。</p></body></html>',
        );
        return;
      }
      this.finish(pending, { tokenResponse });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><p style="font-family:sans-serif">登录成功！可以关闭此窗口并返回 dsh web。</p></body></html>');
    } catch (error) {
      // A code that fails to exchange is likely a non-final code: keep the
      // pending alive so the final callback can still succeed. Remember why it
      // failed — if nothing better arrives, the timeout reports this instead of
      // a bare "timed out".
      pending.lastError = error.message;
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`登录尚未完成: ${error.message}`);
    }
  }

  /**
   * Resolve the pending login for a callback's `state`.
   *
   * An exact match always wins. When the callback carries no state at all —
   * which a hop in claude.com's magic-link flow can do — fall back to the sole
   * login in flight; PKCE still binds the code to that login's verifier, so an
   * injected code cannot be exchanged.
   *
   * A *mismatched* non-empty state is never accepted. It says the code belongs
   * to some other authorization request, which is the shape a login-CSRF takes.
   */
  findPending(state) {
    if (this.pendingByState.has(state)) return this.pendingByState.get(state);
    if (state.length === 0 && this.pendingByState.size === 1) {
      const [only] = this.pendingByState.values();
      return only;
    }
    return undefined;
  }

  finish(pending, outcome) {
    pending.disarm();
    this.pendingByState.delete(pending.state);
    this.pendingByFlow.delete(pending.flowId);
    if (pending.promise === undefined) return;
    if (outcome.error !== undefined) pending.reject(new Error(outcome.error));
    else pending.resolve(outcome.tokenResponse);
  }
}

/** Exchange an authorization code for tokens at the platform token endpoint. */
async function exchangeCode(code, redirectUri, verifier, state) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: OAUTH_CLIENT_ID,
    code_verifier: verifier,
    state,
    expires_in: TOKEN_LIFETIME_SECONDS,
  });
}

/** Refresh an access token with the refresh grant. */
export async function refreshAccessToken(refreshToken) {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPES,
  });
}

/** POST one JSON OAuth request and parse the JSON response. */
async function tokenRequest(payload) {
  let response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`无法连接 Claude OAuth 服务: ${error.message}`);
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
 * Refreshes currently in flight, keyed by credentials seam.
 *
 * Anthropic rotates the refresh token on use, so two concurrent refreshes race
 * to invalidate each other and can leave the session unrecoverable. Every
 * caller that arrives while one is running awaits that same result.
 */
const refreshInFlight = new WeakMap();

/** Refresh the access token, collapsing concurrent callers onto one request. */
function refreshOnce(credentials, refreshToken) {
  const existing = refreshInFlight.get(credentials);
  if (existing !== undefined) return existing;
  const pending = (async () => {
    const refreshed = await refreshAccessToken(refreshToken);
    await credentials.set(REF_ACCESS, accessEnvelope(refreshed.access_token, refreshed.expires_in ?? 1800));
    if (typeof refreshed.refresh_token === 'string' && refreshed.refresh_token.length > 0) {
      await credentials.set(REF_REFRESH, refreshed.refresh_token);
    }
    return refreshed.access_token;
  })().finally(() => {
    refreshInFlight.delete(credentials);
  });
  refreshInFlight.set(credentials, pending);
  return pending;
}

/**
 * Read the stored OAuth credentials and return a usable access token,
 * refreshing first when the stored one has expired.
 * @param credentials - the credentials seam.
 * @returns `{ accessToken }`.
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
  return { accessToken: await refreshOnce(credentials, refreshHit.value) };
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

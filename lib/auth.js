/**
 * Subscription token sources for the Claude adapter.
 *
 * Two ways to get subscription access without a popup OAuth flow:
 * 1. A pasted API token from `claude setup-token` (or any `user:inference`
 *    token), stored in the credentials seam under {@link AUTH_REF};
 * 2. The existing Claude Code login at `~/.claude/.credentials.json`, read
 *    fresh on every request (Claude Code rotates it), refreshed through the
 *    platform token endpoint when expired.
 *
 * @module dsh-claude-subscriptions/auth
 */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

/** Credential refs this plugin owns. */
export const AUTH_REF = credentialRef('CLAUDE_SUBSCRIPTION_TOKEN');
export const LOGIN_REF = credentialRef('CLAUDE_LOGIN_TOKEN');

/** Endpoints copied from Claude Code v2.1.234's shipped config. */
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_SCOPES = 'user:inference user:profile';

/** Headroom (ms) kept before a token is treated as expired. */
const EXPIRY_MARGIN_MS = 60_000;

/** Absolute path of the Claude Code credentials file (respects CLAUDE_CONFIG_DIR). */
export function claudeCodePath() {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return join(dir, '.credentials.json');
}

/** Decode the JWT payload of an access token (claims only, no verification). */
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

/** Best-effort account label from a token. */
export function accountFromToken(token) {
  if (typeof token !== 'string' || token.length === 0) return '';
  try {
    const claims = jwtClaims(token);
    if (typeof claims.email === 'string' && claims.email.length > 0) return claims.email;
    if (typeof claims.sub === 'string' && claims.sub.length > 0) return claims.sub;
  } catch {
    // ignore
  }
  return '';
}

/**
 * Read the Claude Code credentials file at an exact path. Never throws: a
 * missing/unreadable file simply yields undefined.
 * @param filePath - defaults to {@link claudeCodePath}.
 * @returns the `claudeAiOauth` object, or undefined.
 */
export async function readClaudeCodeLoginAt(filePath = claudeCodePath()) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const oauth = parsed?.claudeAiOauth;
    if (oauth == null || typeof oauth !== 'object') return undefined;
    return {
      accessToken: typeof oauth.accessToken === 'string' ? oauth.accessToken : undefined,
      refreshToken: typeof oauth.refreshToken === 'string' ? oauth.refreshToken : undefined,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : undefined,
      subscriptionType: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : undefined,
      rateLimitTier: typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : undefined,
      scopes: Array.isArray(oauth.scopes) ? oauth.scopes : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Convenience wrapper using the default path. */
export function readClaudeCodeLogin() {
  return readClaudeCodeLoginAt();
}

/** Refresh an access token with the refresh grant at the platform endpoint. */
export async function refreshAccessToken(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      scope: OAUTH_SCOPES,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = data.error_description ?? data.error ?? `HTTP ${response.status}`;
    throw new Error(`令牌续期失败: ${description}`);
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('令牌续期响应缺少 access_token');
  }
  return data;
}

/**
 * Write the refreshed token pair back into the Claude Code credentials file
 * (atomic, preserving every other field), so Claude Code's own login stays
 * healthy — the platform ROTATES refresh tokens, and discarding the new one
 * would break the stored login.
 * @returns nothing; failures are non-fatal (the seam cache still holds it).
 */
async function writeBackLoginFile(filePath, next) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.claudeAiOauth == null || typeof parsed.claudeAiOauth !== 'object') return;
    parsed.claudeAiOauth.accessToken = next.accessToken;
    parsed.claudeAiOauth.refreshToken = next.refreshToken;
    parsed.claudeAiOauth.expiresAt = next.expiresAt;
    if (next.refreshTokenExpiresAt !== undefined) {
      parsed.claudeAiOauth.refreshTokenExpiresAt = next.refreshTokenExpiresAt;
    }
    const tmp = `${filePath}.dsh-tmp`;
    await writeFile(tmp, JSON.stringify(parsed, null, 2), 'utf8');
    await rename(tmp, filePath);
  } catch {
    // non-fatal: the seam cache below still holds the refreshed pair
  }
}

/**
 * Resolve a usable subscription bearer token, in priority order:
 * 1. the pasted token ({@link AUTH_REF});
 * 2. the live Claude Code login file, refreshed (rotation-safe, persisted
 *    back to the file and cached in {@link LOGIN_REF}) when expired;
 * 3. our cached refresh ({@link LOGIN_REF}).
 * @param credentials - the credentials seam (optional).
 * @param filePath - override for the Claude Code file (tests).
 * @returns `{ kind: 'subscription', token, source }` or undefined.
 */
export async function resolveSubscriptionToken(credentials, filePath) {
  if (credentials !== undefined) {
    const pasted = await credentials.resolve(AUTH_REF);
    if (pasted !== undefined && pasted.value.length > 0) {
      return { kind: 'subscription', token: pasted.value, source: 'pasted' };
    }
  }
  const login = await readClaudeCodeLoginAt(filePath);
  if (login?.accessToken !== undefined) {
    if (login.expiresAt === undefined || Date.now() < login.expiresAt - EXPIRY_MARGIN_MS) {
      return { kind: 'subscription', token: login.accessToken, source: 'claude-code' };
    }
    if (login.refreshToken !== undefined) {
      try {
        const refreshed = await refreshAccessToken(login.refreshToken);
        const next = {
          accessToken: refreshed.access_token,
          // Rotation-safe: the platform may invalidate the old refresh token.
          refreshToken: refreshed.refresh_token ?? login.refreshToken,
          expiresAt: Date.now() + (refreshed.expires_in ?? 28800) * 1000 - EXPIRY_MARGIN_MS,
        };
        if (typeof refreshed.refresh_token_expires_in === 'number') {
          next.refreshTokenExpiresAt = Date.now() + refreshed.refresh_token_expires_in * 1000;
        }
        if (credentials !== undefined) {
          await credentials.set(LOGIN_REF, JSON.stringify(next));
        }
        await writeBackLoginFile(filePath ?? claudeCodePath(), next);
        return { kind: 'subscription', token: next.accessToken, source: 'claude-code' };
      } catch {
        // expired and refresh failed — fall through to the cached refresh
      }
    }
  }
  if (credentials !== undefined) {
    const cached = await credentials.resolve(LOGIN_REF);
    if (cached !== undefined && cached.value.length > 0) {
      try {
        const envelope = JSON.parse(cached.value);
        if (typeof envelope.accessToken === 'string' && envelope.accessToken.length > 0) {
          return { kind: 'subscription', token: envelope.accessToken, source: 'claude-code' };
        }
      } catch {
        // legacy plain-token cache
        return { kind: 'subscription', token: cached.value, source: 'claude-code' };
      }
    }
  }
  return undefined;
}

/**
 * Display status of the Claude Code login, for the Subscriptions tab.
 * @returns plain JSON fields, or undefined when no login file exists.
 */
export async function claudeCodeStatus(filePath = claudeCodePath()) {
  const login = await readClaudeCodeLoginAt(filePath);
  if (login === undefined) return undefined;
  return {
    source: 'claude-code',
    account: accountFromToken(login.accessToken),
    subscriptionType: login.subscriptionType ?? '',
    rateLimitTier: login.rateLimitTier ?? '',
    expiresAt: login.expiresAt ?? 0,
    scopes: Array.isArray(login.scopes) ? login.scopes.join(' ') : '',
  };
}

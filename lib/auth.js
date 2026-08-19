/**
 * Anthropic credential resolution.
 *
 * Four sources are tried in the order Anthropic's own SDKs use, so a machine
 * already set up for the API behaves the same here:
 *
 *   1. a key stored through this plugin's settings tab
 *   2. `ANTHROPIC_API_KEY` from the launch environment
 *   3. `ANTHROPIC_AUTH_TOKEN` from the launch environment
 *   4. a profile created by `ant auth login`
 *
 * The two kinds are not interchangeable on the wire: an API key is sent in
 * `x-api-key`, while an OAuth access token is a bearer token and additionally
 * needs the `oauth-2025-04-20` beta gate. Sending either one the other way is
 * a 401, which is what {@link authHeaders} exists to prevent.
 *
 * @module dsh-claude-subscriptions/auth
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LlmError, assertUsableApiKey } from '@deepseek-ai/dsh-llm';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

const run = promisify(execFile);

/** Credential reference for a key the user stores through the settings tab. */
export const REF_API_KEY = credentialRef('ANTHROPIC_API_KEY');

/** Environment variable holding a plain API key. */
const ENV_API_KEY = 'ANTHROPIC_API_KEY';

/** Environment variable holding an OAuth access token. */
const ENV_AUTH_TOKEN = 'ANTHROPIC_AUTH_TOKEN';

/** Beta gate every OAuth-authenticated request must carry. */
const OAUTH_BETA = 'oauth-2025-04-20';

/**
 * How long a CLI-minted token is reused before asking again. The tokens are
 * short-lived and `print-credentials` refreshes them on demand, so this only
 * exists to avoid spawning a process per request.
 */
const CLI_TOKEN_TTL_MS = 60_000;

/** How long to wait on the CLI before treating it as unavailable. */
const CLI_TIMEOUT_MS = 10_000;

/** Human-readable label per credential source, for the settings tab. */
export const SOURCE_LABELS = {
  'stored-key': 'API key (saved here)',
  'env-key': `API key (${ENV_API_KEY})`,
  'env-token': `Access token (${ENV_AUTH_TOKEN})`,
  'cli-profile': 'Anthropic CLI login (ant auth login)',
};

let cliCache;

/** Drop any cached CLI token, so the next call re-asks the CLI. */
export function forgetCliToken() {
  cliCache = undefined;
}

/**
 * Ask the Anthropic CLI for a short-lived access token.
 *
 * Every failure mode — CLI absent, not logged in, refresh token expired,
 * hanging — resolves to undefined so the caller can fall through to another
 * source rather than failing the request outright.
 *
 * @returns the bare access token, or undefined when the CLI cannot supply one.
 */
export async function cliAccessToken() {
  if (cliCache !== undefined && cliCache.expiresAt > Date.now()) return cliCache.token;
  let stdout;
  try {
    ({ stdout } = await run('ant', ['auth', 'print-credentials', '--access-token'], {
      timeout: CLI_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    return undefined;
  }
  const token = stdout.trim();
  // Without `--access-token` the CLI prints the whole credentials JSON. Guard
  // against ever putting that in an Authorization header.
  if (token.length === 0 || /\s/.test(token) || token.startsWith('{')) return undefined;
  cliCache = { token, expiresAt: Date.now() + CLI_TOKEN_TTL_MS };
  return token;
}

/** Read one credential reference, returning its value only when non-empty. */
async function storedValue(credentials, ref) {
  if (credentials === undefined || ref === undefined) return undefined;
  const hit = await credentials.resolve(ref);
  return hit === undefined || hit.value.length === 0 ? undefined : hit.value;
}

/** Read one launch-environment variable, returning it only when non-empty. */
function envValue(launchEnvironment, name) {
  const hit = launchEnvironment?.get(name);
  return hit === undefined || hit.value.length === 0 ? undefined : hit.value;
}

/**
 * Resolve one usable Anthropic credential.
 *
 * @param deps.apiKeyEnv - credential reference for the stored key, when configured.
 * @param deps.credentials - the credentials seam, when available.
 * @param deps.launchEnvironment - the launch environment snapshot, when available.
 * @returns `{ kind, token, source }`; `kind` decides the wire headers.
 * @throws LlmError with code `MISSING_CREDENTIAL` when no source supplies one.
 */
export async function resolveAnthropicAuth(deps) {
  const { apiKeyEnv, credentials, launchEnvironment } = deps;

  const stored = await storedValue(credentials, apiKeyEnv ?? REF_API_KEY);
  if (stored !== undefined) {
    return { kind: 'api-key', token: assertUsableApiKey(stored, 'llm-claude', REF_API_KEY), source: 'stored-key' };
  }

  const envKey = envValue(launchEnvironment, ENV_API_KEY);
  if (envKey !== undefined) {
    return { kind: 'api-key', token: assertUsableApiKey(envKey, 'llm-claude', ENV_API_KEY), source: 'env-key' };
  }

  const envToken = envValue(launchEnvironment, ENV_AUTH_TOKEN);
  if (envToken !== undefined) return { kind: 'oauth', token: envToken, source: 'env-token' };

  const cliToken = await cliAccessToken();
  if (cliToken !== undefined) return { kind: 'oauth', token: cliToken, source: 'cli-profile' };

  // Host-side, so there is no locale to render this in. "Claude" is the tab's
  // label in every dictionary, which keeps the instruction followable either way.
  throw new LlmError(
    'llm-claude: no Anthropic credential found. Save an API key in the Claude settings tab, or run `ant auth login` to sign in through the browser.',
    'MISSING_CREDENTIAL',
  );
}

/**
 * Wire headers carrying one resolved credential.
 *
 * An API key goes in `x-api-key`; an OAuth token is a bearer token and needs
 * the beta gate alongside it. These are not interchangeable.
 *
 * @param auth - the result of {@link resolveAnthropicAuth}.
 * @returns headers to merge into the request.
 */
export function authHeaders(auth) {
  return auth.kind === 'api-key'
    ? { 'x-api-key': auth.token }
    : { authorization: `Bearer ${auth.token}`, 'anthropic-beta': OAUTH_BETA };
}

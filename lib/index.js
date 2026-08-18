/**
 * dsh-claude-subscriptions host plugin.
 *
 * Registers the `claude-subscription` provider route on the `llm` seam with a
 * ClaudeAdapter that speaks the Anthropic Messages API, authenticating either
 * through the Claude subscription OAuth flow (loopback callback server +
 * credentials seam) or a plain API key. Owns the `llm-claude` user-settings
 * namespace, which is both the provider profile and the OAuth handshake
 * scratchpad the browser half reads and writes.
 *
 * The settings and credentials seams are consumed REACTIVELY (`ctx.inject` /
 * per-call `ctx.get`): the `llm` service may be ready before the settings
 * document finishes loading, so a one-shot `ctx.get('settings')` at apply time
 * could silently skip the namespace registration and leave the browser half
 * with "settings namespace ... is not registered".
 *
 * @module dsh-claude-subscriptions
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
import { deepEqualJson } from '@deepseek-ai/dsh-settings';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { NS, PROVIDER, PROVIDER_DISPLAY, Config, resolveAdapterOptions } from './config.js';
import { ClaudeAdapter } from './adapter.js';
import { fetchModels } from './anthropic.js';
import { OAuthManager, clearOAuthCredentials, resolveOAuthToken, storeTokenResponse } from './oauth.js';

export const name = 'llm-claude';
export const inject = ['llm'];

/** The host body of the plugin. */
export function apply(ctx, config) {
  // The OAuth manager is created after `options` (below); it needs
  // `verifyToken`, which reads the connection config per call.

  // ── configuration source: settings section layered over the entry ────────
  let current = () => config;
  let lastRaw;
  let lastGood;
  const options = () => {
    const raw = current();
    if (raw === lastRaw && lastGood !== undefined) return lastGood;
    try {
      const next = resolveAdapterOptions(raw);
      lastRaw = raw;
      lastGood = next;
      return next;
    } catch (error) {
      if (lastGood === undefined) throw error;
      lastRaw = raw;
      ctx.logger.error('llm-claude: keeping the last good configuration after an invalid settings section');
      ctx.logger.error(error);
      return lastGood;
    }
  };
  options();

  // ── OAuth manager with token verification ────────────────────────────────
  // claude.com's magic-link + verification-code flow can redirect to the
  // callback with a code whose token is not yet active. A login completes
  // only once the exchanged token actually works against the API.
  const verifyToken = async (tokenResponse) => {
    try {
      const token = tokenResponse.access_token;
      if (typeof token !== 'string' || token.length === 0) return false;
      const scopes =
        typeof tokenResponse.scope === 'string'
          ? tokenResponse.scope.split(/\s+/).filter((scope) => scope.length > 0)
          : [];
      if (scopes.length > 0 && !scopes.includes('user:inference')) return false;
      const opts = options();
      const response = await fetch(`${opts.baseURL}/v1/models`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
        },
        signal: AbortSignal.timeout(15000),
      });
      // 200 → active. 401/403 → not yet usable. Other statuses (endpoint
      // unavailable for this account) must not block an otherwise valid login.
      return response.status === 200 || (response.status !== 401 && response.status !== 403);
    } catch {
      return false;
    }
  };
  const oauth = new OAuthManager({ verifyToken });
  ctx.effect(() => () => oauth.dispose());

  // ── provider route + adapter registration (independent of settings) ──────
  let userId;
  const resolveUserId = () => {
    userId ??= getOrCreateAnonymousUserId();
    return userId;
  };
  const adapter = new ClaudeAdapter({
    options,
    // Credentials and attachments are resolved lazily per call: the seams may
    // appear after apply, and a service restart reaches the next request.
    getCredentials: () => ctx.get('credentials'),
    getAttachments: () => ctx.get('attachments'),
    launchEnvironment: launchEnvironmentOf(ctx),
    resolveOAuthToken: async () => {
      const credentials = ctx.get('credentials');
      if (credentials === undefined) return undefined;
      try {
        return await resolveOAuthToken(credentials);
      } catch {
        return undefined;
      }
    },
    resolveUserId,
  });

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: PROVIDER_DISPLAY, settingsNs: NS, settingsPath: [] },
  ]);
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter);

  // Re-register the route in place when the captured retry policy changes.
  let registeredPolicy = options().retryPolicy;
  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy;
    if (deepEqualJson(policy, registeredPolicy)) return;
    registration.replace([PROVIDER]);
    registeredPolicy = policy;
  };

  // ── model discovery: interrogate the Anthropic Models API ────────────────
  const resolveDiscoveryToken = async () => {
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
      try {
        const oauth = await resolveOAuthToken(credentials);
        if (oauth !== undefined && oauth.accessToken !== undefined) return oauth.accessToken;
      } catch {
        // No usable OAuth session — try the API-key path.
      }
      const opts = options();
      if (opts.apiKeyEnv !== undefined) {
        const hit = await credentials.resolve(opts.apiKeyEnv);
        if (hit !== undefined && hit.value.length > 0) return hit.value;
      }
    }
    throw new LlmError('no Claude credential available to fetch the model list', 'MISSING_CREDENTIAL');
  };

  const autoRefreshModels = async () => {
    try {
      const token = await resolveDiscoveryToken();
      const opts = options();
      const found = await fetchModels(opts.baseURL, token);
      if (found.length === 0) return undefined;
      return found.map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: opts.defaultContextWindow,
        maxTokens: opts.maxTokens,
      }));
    } catch (error) {
      ctx.logger.error('llm-claude: model discovery failed');
      ctx.logger.error(error);
      return undefined;
    }
  };

  ctx.llm.registerModelDiscovery(NS, async (request) => {
    const baseURL = request.baseURL ?? options().baseURL;
    let token;
    if (typeof request.apiKey === 'string' && request.apiKey.length > 0) {
      token = request.apiKey;
    } else {
      token = await resolveDiscoveryToken();
    }
    const found = await fetchModels(baseURL, token, request.signal);
    const opts = options();
    return found.map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: opts.defaultContextWindow,
      maxTokens: opts.maxTokens,
    }));
  });

  // ── settings namespace + OAuth handshake (reactive) ──────────────────────
  // `ctx.inject` runs the callback only once the settings service is
  // available and re-runs it after the service restarts; the cleanup that
  // restores the entry-only source is registered on the sub-context via
  // `sctx.effect`, exactly like dsh-settings' installSettingsSection.
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config, { base: config });
    current = () => scope.get();
    sctx.effect(() => () => {
      current = () => config;
    });
    sctx.effect(() => {
      const unwatchFlow = scope.watch((next, prev) => {
        runFlowHandshake({ ctx: sctx, oauth, scope, autoRefreshModels }, next, prev).catch((error) => {
          ctx.logger.error('llm-claude: OAuth handshake failed');
          ctx.logger.error(error);
        });
      });
      const unwatchPolicy = scope.watch(() => ensureRegistrationFacts());
      return () => {
        unwatchFlow();
        unwatchPolicy();
      };
    });
  });

  // Host-side affordances the browser half drives through the settings and
  // credentials seams (no custom RPC): connect = write `flow`; disconnect =
  // unset the OAuth credentials + clear `auth`.
}

/**
 * Drive one OAuth handshake from a settings commit: a fresh `flow` written by
 * the browser triggers login (authorize URL written back), the loopback
 * callback completes it, tokens land in the credentials seam, and `auth`
 * mirrors the connection facts for display. After a successful login the
 * model catalog is refreshed from the Anthropic Models API.
 *
 * Note: schemastery resolves the optional `flow`/`auth` objects to `{}` when
 * absent, so every gate keys off the non-empty `flowId` string, never the
 * object's presence.
 */
async function runFlowHandshake(deps, next, prev) {
  const { ctx, oauth, scope, autoRefreshModels } = deps;
  const flow = next.flow;
  const flowId = flow != null && typeof flow.flowId === 'string' && flow.flowId.length > 0 ? flow.flowId : undefined;

  if (flowId === undefined) {
    const prevFlowId =
      prev?.flow != null && typeof prev.flow.flowId === 'string' && prev.flow.flowId.length > 0
        ? prev.flow.flowId
        : undefined;
    // The browser cancelled or timed out: drop the pending login, if any.
    if (prevFlowId !== undefined) oauth.cancelLogin(prevFlowId);
    return;
  }

  const alreadyServed =
    prev?.flow?.flowId === flowId && typeof prev.flow.url === 'string' && prev.flow.url.length > 0;
  if (alreadyServed) return;
  if (typeof flow.url === 'string' && flow.url.length > 0) return;

  const url = await oauth.beginLogin(flowId);
  await scope.update({ flow: { flowId, url, startedAt: flow.startedAt ?? Date.now() } });
  const outcome = oauth.awaitLogin(flowId);
  if (outcome === undefined) return;
  try {
    const tokenResponse = await outcome;
    const credentials = ctx.get('credentials');
    if (credentials === undefined) throw new Error('credentials service unavailable');
    const label = await storeTokenResponse(credentials, tokenResponse);
    const models = await autoRefreshModels();
    await scope.update({
      auth: {
        method: 'oauth',
        account: label.account,
        organizationId: label.organizationId,
        connectedAt: Date.now(),
      },
      ...(models === undefined ? {} : { models }),
    });
  } catch (error) {
    await scope.update({ auth: undefined }).catch(() => {});
    throw error;
  } finally {
    // Unset the handshake scratchpad (mutate, since `update` cannot express null).
    await ctx.settings.mutate(NS, [{ op: 'unset', path: ['flow'] }]).catch(() => {});
  }
}

// Re-export for tooling and diagnostics.
export { Config, NS, PROVIDER, runFlowHandshake };

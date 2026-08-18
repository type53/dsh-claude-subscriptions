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
import { deepEqualJson } from '@deepseek-ai/dsh-settings';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { NS, PROVIDER, PROVIDER_DISPLAY, Config, resolveAdapterOptions } from './config.js';
import { ClaudeAdapter } from './adapter.js';
import { OAuthManager, clearOAuthCredentials, resolveOAuthToken, storeTokenResponse } from './oauth.js';

export const name = 'llm-claude';
export const inject = ['llm'];

/** The host body of the plugin. */
export function apply(ctx, config) {
  const oauth = new OAuthManager();
  ctx.effect(() => () => oauth.dispose());

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

  // ── provider route + adapter registration (independent of settings) ──────
  let userId;
  const resolveUserId = () => {
    userId ??= getOrCreateAnonymousUserId();
    return userId;
  };
  const adapter = new ClaudeAdapter({
    options,
    // Credentials are resolved lazily per call: the seam may appear after apply.
    getCredentials: () => ctx.get('credentials'),
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
        runFlowHandshake({ ctx: sctx, oauth, scope }, next, prev).catch((error) => {
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
 * mirrors the connection facts for display.
 */
async function runFlowHandshake(deps, next, prev) {
  const { ctx, oauth, scope } = deps;
  const flow = next.flow;
  // The browser cancelled or timed out: drop the pending login, if any.
  if (flow === undefined) {
    if (prev?.flow?.flowId !== undefined) oauth.cancelLogin(prev.flow.flowId);
    return;
  }
  const alreadyServed = prev?.flow?.flowId === flow.flowId && prev.flow.url !== undefined;
  if (alreadyServed) return;
  if (flow.url !== undefined) return;

  const flowId = flow.flowId;
  const url = await oauth.beginLogin(flowId);
  await scope.update({ flow: { flowId, url, startedAt: flow.startedAt ?? Date.now() } });
  const outcome = oauth.awaitLogin(flowId);
  if (outcome === undefined) return;
  try {
    const tokenResponse = await outcome;
    const credentials = ctx.get('credentials');
    if (credentials === undefined) throw new Error('credentials service unavailable');
    const label = await storeTokenResponse(credentials, tokenResponse);
    await scope.update({
      auth: {
        method: 'oauth',
        account: label.account,
        organizationId: label.organizationId,
        connectedAt: Date.now(),
      },
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
export { Config, NS, PROVIDER };

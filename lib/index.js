/**
 * dsh-claude-subscriptions host plugin.
 *
 * Registers the `claude-subscription` provider route on the `llm` seam with a
 * ClaudeAdapter that speaks the Anthropic Messages API. Subscription access
 * comes from one of two sources (no popup OAuth flow): a pasted
 * `claude setup-token` token in the credentials seam, or the live Claude Code
 * login at `~/.claude/.credentials.json`. A plain Anthropic API key remains
 * the fallback.
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
import { resolveSubscriptionToken, claudeCodeStatus } from './auth.js';

export const name = 'llm-claude';
export const inject = ['llm'];

/** The host body of the plugin. */
export function apply(ctx, config) {
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
    // Credentials and attachments are resolved lazily per call: the seams may
    // appear after apply, and a service restart reaches the next request.
    getCredentials: () => ctx.get('credentials'),
    getAttachments: () => ctx.get('attachments'),
    launchEnvironment: launchEnvironmentOf(ctx),
    resolveSubscriptionToken: async () => resolveSubscriptionToken(ctx.get('credentials')),
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
        const subscription = await resolveSubscriptionToken(credentials);
        if (subscription !== undefined && subscription.token !== undefined) return subscription.token;
      } catch {
        // Subscription resolution failed — try the API-key path.
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

  // ── settings namespace + status mirroring (reactive) ─────────────────────
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

    // Mirror the Claude Code login status into `llm-claude.status` so the
    // Subscriptions tab can display it; only write on change.
    const computeAndPublishStatus = async () => {
      try {
        const status = await claudeCodeStatus();
        const existing = scope.get().status;
        const present = existing != null && typeof existing === 'object' && Object.keys(existing).length > 0;
        if (status === undefined) {
          if (present) {
            await sctx.settings.mutate(NS, [{ op: 'unset', path: ['status'] }]).catch(() => {});
          }
          return;
        }
        if (present && deepEqualJson(existing, status)) return;
        await sctx.settings.mutate(NS, [{ op: 'set', path: ['status'], value: status }]).catch(() => {});
      } catch (error) {
        ctx.logger.error('llm-claude: status refresh failed');
        ctx.logger.error(error);
      }
    };

    sctx.effect(() => {
      computeAndPublishStatus();
      const unwatchRefresh = scope.watch((next, prev) => {
        if (next.refresh?.at !== prev?.refresh?.at && next.refresh?.at !== undefined) {
          computeAndPublishStatus().then(async () => {
            await sctx.settings.mutate(NS, [{ op: 'unset', path: ['refresh'] }]).catch(() => {});
          });
        }
      });
      const unwatchPolicy = scope.watch(() => ensureRegistrationFacts());
      return () => {
        unwatchRefresh();
        unwatchPolicy();
      };
    });
  });

  // Host-side affordances the browser half drives through the settings and
  // credentials seams (no custom RPC): refresh status = write `refresh`;
  // clear pasted token = unset `CLAUDE_SUBSCRIPTION_TOKEN`.
}

// Re-export for tooling and diagnostics.
export { Config, NS, PROVIDER };

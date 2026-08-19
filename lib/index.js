/**
 * dsh-claude-subscriptions host plugin.
 *
 * Registers the `claude-subscription` provider route on the `llm` seam with a
 * ClaudeAdapter that speaks the Anthropic Messages API. Credentials come from
 * whichever supported source the machine already has — a key saved through the
 * settings tab, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or a profile from
 * `ant auth login` — resolved per request by {@link resolveAnthropicAuth}.
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
import { fetchModels } from './anthropic.js';
import { resolveAnthropicAuth } from './auth.js';

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

  const launchEnvironment = launchEnvironmentOf(ctx);

  // Credentials are resolved per call: the seam may appear after apply, and a
  // key saved in the settings tab must take effect without a restart.
  const resolveAuth = () =>
    resolveAnthropicAuth({
      apiKeyEnv: options().apiKeyEnv,
      credentials: ctx.get('credentials'),
      launchEnvironment,
    });

  // Set once the settings service is available; mirrors the credential the
  // host actually resolved so the settings tab can display it.
  let recordAuth = () => {};

  // ── provider route + adapter registration (independent of settings) ──────
  let userId;
  const resolveUserId = () => {
    userId ??= getOrCreateAnonymousUserId();
    return userId;
  };
  const adapter = new ClaudeAdapter({
    options,
    getAttachments: () => ctx.get('attachments'),
    resolveAuth,
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

  // ── model discovery ──────────────────────────────────────────────────────
  // Also the settings tab's "test connection": it resolves a credential and
  // makes a real request, so a success here means chat will work too.
  ctx.llm.registerModelDiscovery(NS, async (request) => {
    const baseURL = request.baseURL ?? options().baseURL;
    const auth =
      typeof request.apiKey === 'string' && request.apiKey.length > 0
        ? { kind: 'api-key', token: request.apiKey, source: 'stored-key' }
        : await resolveAuth();
    const found = await fetchModels(baseURL, auth, request.signal);
    recordAuth(auth);
    const opts = options();
    return found.map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: opts.defaultContextWindow,
      maxTokens: opts.maxTokens,
    }));
  });

  // ── settings namespace (reactive) ────────────────────────────────────────
  // `ctx.inject` runs the callback only once the settings service is
  // available and re-runs it after the service restarts; the cleanup that
  // restores the entry-only source is registered on the sub-context via
  // `sctx.effect`, exactly like dsh-settings' installSettingsSection.
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config, { base: config });
    current = () => scope.get();
    recordAuth = (auth) => {
      scope
        .update({ auth: { kind: auth.kind, source: auth.source, checkedAt: Date.now() } })
        .catch((error) => {
          ctx.logger.error('llm-claude: could not record the resolved credential');
          ctx.logger.error(error);
        });
    };
    sctx.effect(() => () => {
      current = () => config;
      recordAuth = () => {};
    });
    sctx.effect(() => scope.watch(() => ensureRegistrationFacts()));
  });
}

// Re-export for tooling and diagnostics.
export { Config, NS, PROVIDER };

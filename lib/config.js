/**
 * Config, defaults, and the settings-namespace schema for the Claude adapter.
 *
 * The whole `llm-claude` user-settings section is the provider profile
 * (`settingsPath: []`), mirroring how `llm-deepseek` owns its namespace.
 *
 * @module dsh-claude-subscriptions/config
 */
import z from '@deepseek-ai/schemastery';
import { RetryPolicySchema, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';

/** The settings namespace this plugin owns. */
export const NS = settingsNamespace('llm-claude');

/** The single provider route this plugin owns. */
export const PROVIDER = 'claude-subscription';

/** Provider display name shown in pickers and the Models page. */
export const PROVIDER_DISPLAY = 'Claude (Anthropic)';

/** Default Anthropic Messages API root (without the /v1 suffix). */
export const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * Default combined request/response context capacity. Deliberately the
 * conservative 200K figure: it is the fallback for models whose real window
 * this plugin does not know, and under-reporting only costs some headroom.
 */
export const DEFAULT_CONTEXT_WINDOW = 200000;

/** Context capacity of the current 1M-token models. */
export const LARGE_CONTEXT_WINDOW = 1000000;

/** Default per-request output-token cap. */
export const DEFAULT_MAX_TOKENS = 32000;

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;

/** Default credential reference used in API-key mode. */
export const DEFAULT_API_KEY_ENV = 'ANTHROPIC_API_KEY';

/**
 * Advisory model catalog, replaced by whatever `/v1/models` returns once a
 * credential is configured. Catalog membership is advisory — the adapter
 * accepts any model id the endpoint accepts.
 *
 * No `description`: these are rendered host-side with no locale to translate
 * into, and discovery does not supply one either, so omitting it keeps the
 * shipped catalog and the discovered one looking the same.
 */
export const DEFAULT_MODELS = [
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    contextWindow: LARGE_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    contextWindow: LARGE_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
];

/** One catalog entry as the settings schema validates it. */
export const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
});

/**
 * The `llm-claude` settings section. `apiKeyEnv` stays optional: it only
 * overrides which credential reference holds the API key. Leaving it unset
 * still resolves the default reference, the environment, or a CLI login.
 */
export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  thinking: z.union(['enabled', 'disabled']).default('enabled'),
  reasoningEffort: z.union(['off', 'high', 'max']).default('high'),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  models: z.array(catalogModel).default(DEFAULT_MODELS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(0x7fffffff).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
  /**
   * Which credential the host last resolved, mirrored for display. Written
   * whenever model discovery runs, which is also how the settings tab tests a
   * connection — so what is shown here is what a real request would use.
   */
  auth: z.object({
    kind: z.union(['api-key', 'oauth']),
    source: z.union(['stored-key', 'env-key', 'env-token', 'cli-profile']),
    checkedAt: z.number(),
  }),
});

/** Validate and detach the advisory model catalog. */
export function resolveModels(models) {
  const seen = new Set();
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (model.id.length === 0) throw new Error('llm-claude: catalog model ids must be non-empty');
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-claude: catalog model "${model.id}" has an empty name`);
    }
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(`llm-claude: catalog model "${model.id}" contextWindow must be a positive integer`);
    }
    if (model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(`llm-claude: catalog model "${model.id}" maxTokens must be a positive integer`);
    }
    if (seen.has(model.id)) throw new Error(`llm-claude: duplicate catalog model "${model.id}"`);
    seen.add(model.id);
    return {
      id: model.id,
      ...(model.name === undefined ? {} : { name: model.name }),
      ...(model.description === undefined ? {} : { description: model.description }),
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    };
  });
}

/**
 * One explicit resolve step from raw config to validated connection facts.
 * Programmatic construction may bypass Schemastery normalization, so every
 * default and bound is re-judged here.
 * @param config - raw plugin config or resolved settings snapshot.
 * @returns validated connection facts plus the optional credential reference.
 */
export function resolveAdapterOptions(config) {
  if (config.thinking === 'disabled' && config.reasoningEffort !== undefined && config.reasoningEffort !== 'off') {
    throw new Error('llm-claude: only reasoningEffort "off" can be configured when thinking is disabled');
  }
  if (config.defaultContextWindow !== undefined && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('llm-claude: defaultContextWindow must be a positive integer');
  }
  if (config.maxTokens !== undefined && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error('llm-claude: maxTokens must be a positive safe integer');
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0) {
    throw new Error('llm-claude: streamIdleTimeoutMs must be a positive finite number');
  }
  return {
    apiKeyEnv: config.apiKeyEnv === undefined || config.apiKeyEnv.length === 0 ? undefined : config.apiKeyEnv,
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
    defaults: {
      thinking: config.thinking ?? 'enabled',
      reasoningEffort: config.reasoningEffort ?? 'high',
    },
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-claude: retryPolicy'),
  };
}

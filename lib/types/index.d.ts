/**
 * Minimal type surface for the host plugin.
 * @module dsh-claude-subscriptions
 */
export { Config, NS, PROVIDER, PROVIDER_DISPLAY, DEFAULT_MODELS, resolveAdapterOptions } from '../config.js';
export { REF_API_KEY, authHeaders, resolveAnthropicAuth } from '../auth.js';
export { apply, inject, name } from '../index.js';

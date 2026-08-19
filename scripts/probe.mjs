/**
 * Direct Anthropic API probe: bypasses the harness error wrapping so the raw
 * API response is visible. Never prints the token.
 * Usage: node scripts/probe.mjs [model] [thinking|no-thinking]
 * Token source: $DSH_HOME/.credentials.yaml (CLAUDE_SUBSCRIPTION_TOKEN),
 *              then CLAUDE_PROBE_TOKEN env, then the Claude Code login file.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const model = process.argv[2] ?? 'claude-opus-5';
const thinking = process.argv[3] !== 'no-thinking';
const BASE_URL = 'https://api.anthropic.com';

async function readToken() {
  if (process.env.CLAUDE_PROBE_TOKEN !== undefined && process.env.CLAUDE_PROBE_TOKEN.length > 0) {
    return process.env.CLAUDE_PROBE_TOKEN;
  }
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const credPath = join(home, '.credentials.yaml');
  try {
    const raw = await readFile(credPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('CLAUDE_SUBSCRIPTION_TOKEN:')) {
        let value = line.slice('CLAUDE_SUBSCRIPTION_TOKEN:'.length).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return value;
      }
    }
  } catch {
    // fall through to the login file
  }
  const loginPath = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), '.credentials.json');
  try {
    const parsed = JSON.parse(await readFile(loginPath, 'utf8'));
    return parsed?.claudeAiOauth?.accessToken;
  } catch {
    return undefined;
  }
}

const token = await readToken();
if (token === undefined || token.length === 0) {
  console.error('no token found — set CLAUDE_PROBE_TOKEN or paste one into 设置 → 订阅');
  process.exit(1);
}
console.log(`token found: len=${token.length}, prefix=${token.slice(0, 6)}... (not printed)`);

const body = {
  model,
  max_tokens: 64,
  stream: true,
  messages: [{ role: 'user', content: 'Say OK' }],
  ...(thinking
    ? { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }
    : {}),
};
const betas = ['oauth-2025-04-20', ...(thinking ? ['effort-2025-11-24'] : [])];

console.log(`--- probe: model=${model} thinking=${thinking ? 'adaptive(effort:low)' : 'off'} betas=${betas.join(',')}`);
const response = await fetch(`${BASE_URL}/v1/messages`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': betas.join(','),
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});
console.log('status:', response.status, response.statusText);
const text = await response.text();
console.log('--- raw body head ---');
console.log(text.slice(0, 800));
console.log('--- end ---');

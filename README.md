<div align="center">

# dsh-claude-subscriptions

**Use your Claude subscription (Pro / Max) directly in DeepSeek Harness web**

[简体中文](README.zh.md) · English

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

Reuse your Claude subscription (Pro / Max) from DeepSeek Harness web — the plugin reads your local **Claude Code login** or a token from **`claude setup-token`**. Once connected, pick Claude's Opus / Sonnet / Haiku models right in your conversations.

</div>

---

## What it does

If you already have a **Claude Pro / Max subscription** and use **DeepSeek Harness web** day-to-day, this plugin lets you switch models in the same interface:

- **Settings → Subscriptions** shows your live subscription status (account, plan, rate-limit tier) — read straight from your **Claude Code login** (`~/.claude/.credentials.json`), no popup login;
- No Claude Code login handy? Paste a token from **`claude setup-token`** (an official Anthropic command for using your subscription with SDKs/APIs — subject to the subscription terms and model entitlements) and the plugin uses it;
- Once a token is available, Claude models show up in the **model picker** next to the input box (or `/model`) — select one and the agent works with Claude, whether it's code, writing, or analysis;
- The **model list is fetched from Anthropic automatically** and can be refreshed from the Subscriptions tab;
- **Image input** is supported: attach a screenshot or image and Claude reads it;
- No subscription? A plain **Anthropic API key** is supported as a fallback.

> It only adds an **optional model provider** to dsh web — your existing DeepSeek setup is untouched, and you can switch back anytime from the model picker.

> ⚠️ **Terms of use**: subscription tokens are for *personal* use. Light, human-paced use of your own login is the norm for tools like this; heavy or automated usage risks throttling or account action from Anthropic. Use at your own discretion.

## Installation

**Prerequisites**: DeepSeek Harness web installed and running (`dsh --profile web`), Node.js 20+ and pnpm on your machine.

### Option A: install via npm (recommended)

Once the plugin is published to npm, one command:

```bash
dsh plugin --profile web add dsh-claude-subscriptions
```

### Option B: link from source (until it's on npm)

```powershell
# 1) Clone to any local directory
git clone https://github.com/type53/dsh-claude-subscriptions.git
cd dsh-claude-subscriptions
pnpm install

# 2) Mount the plugin into the web profile
#    Open $env:USERPROFILE\.dsh\profiles\web\package.json and make two edits:
#    a) append "dsh-claude-subscriptions" to the dsh.profile.bundles array
#    b) add "dsh-claude-subscriptions": "link:<absolute path from step 1>" to dependencies
#    Then install:
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install

# 3) Restart dsh web
dsh --profile web
```

> If your `DSH_HOME` is not the default `%USERPROFILE%\.dsh`, replace the path in step 2 with your own `$DSH_HOME\profiles\web`.

## Quick start

1. Make sure Claude Code is logged in on this machine (`claude login`), or run `claude setup-token` and keep the token;
2. Open dsh web, go to **Settings → Subscriptions** — the tab shows **Claude Code login detected** (or lets you **paste a setup-token**);
3. If the token is expired, the plugin refreshes it automatically (and writes the refreshed token back so your Claude Code stays healthy);
4. Start or continue a conversation, open the model picker next to the input box (or type `/model`), and choose a Claude model:

```
/model claude-sonnet-4-5
```

The agent now works with that model. To stop using a pasted token, click **Clear token** in the Subscriptions tab.

## FAQ

**The Subscriptions tab shows "No subscription credentials detected"?**
Claude Code is not logged in on this machine (or `~/.claude/.credentials.json` is missing). Run `claude login`, then click **Refresh status**; or paste a token from `claude setup-token`.

**Claude Code says "Re-authenticate to continue"?**
The stored login expired or was invalidated. Run `claude login` once in a terminal — the plugin picks the fresh login up on its next request.

**401 / token expired while using it?**
The plugin auto-refreshes the Claude Code token (rotation-safe: the new token is written back to the credentials file). If refresh fails, re-run `claude login`.

**Opus / Sonnet fail with "Retry delay / Failure reason: Error"?**
That "Error" is Anthropic's own terse message for `rate_limit_error` — the subscription API gives opus/sonnet very little (often zero) quota. Haiku is typically available. Anthropic policy restricts flagship-model API usage for subscriptions; use haiku through the plugin, or a paid API key for premium models.

**Haiku errors with "adaptive thinking is not supported"?**
Older models reject the modern thinking API. The plugin detects this and automatically retries with thinking disabled.

**The tab shows a login, but no Claude models in the picker?**
Restart dsh web once, then search `claude` in `/model`. The picker lists models from the provider catalog, which loads on the first request.

**Which Claude models can I use?**
Depends on your plan. The plugin fetches the list from Anthropic automatically; you can override it in configuration (below).

**Does it support images / vision?**
Yes. Attach images (PNG / JPEG / WebP / GIF) to a message and the plugin sends them to Claude as base64 image blocks.

**Will this affect my existing DeepSeek models?**
Not at all. It only adds a provider; switch between them freely.

## Advanced: custom model list (optional)

The model list refreshes automatically after you connect (and via the **Refresh model list** button in the Subscriptions tab). If you want to override it by hand, add an `llm-claude` section to `$DSH_HOME\settings.yaml`:

```yaml
llm-claude:
  reasoningEffort: high          # off | low | medium | high | xhigh | max, thinking intensity
  maxTokens: 32000
  defaultContextWindow: 200000
  models:
    - id: claude-sonnet-5
      name: Claude Sonnet 5
      contextWindow: 200000
      maxTokens: 32000
```

> The model list is advisory: the Anthropic endpoint accepts any model id it knows, so unlisted models work too.

## How it works (for the curious)

- **Credentials**: the plugin reads your Claude Code login at `~/.claude/.credentials.json` (`claudeAiOauth`) on every request, so token rotations by Claude Code are picked up automatically. A pasted `claude setup-token` token (stored in the dsh credentials seam) takes priority;
- **Refresh**: when the stored access token is expired, the plugin refreshes it at `platform.claude.com/v1/oauth/token` and writes the new token pair back to the file (Anthropic rotates refresh tokens — discarding the new one would break the login), with a seam-side cache as backup;
- **Calls**: the plugin streams requests to the Anthropic Messages API with the subscription bearer token (`anthropic-beta: oauth-2025-04-20`), with full tool-call, extended-thinking, and image support;
- **Integration**: the plugin registers `claude-subscription` as an LLM provider for dsh web, so the model picker and `/model` recognize it directly.

## Development

```bash
pnpm install
node scripts/smoke.mjs                # wire protocol / config / auth-source unit tests
node scripts/host-boot-test.mjs       # host plugin wiring test
node scripts/client-boot-test.mjs     # browser bundle boot test
```

## License

[MIT](LICENSE)

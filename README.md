<div align="center">

# dsh-claude-subscriptions

**Use your Claude subscription (Pro / Max) directly in DeepSeek Harness web**

[简体中文](README.zh.md) · English

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

One-click OAuth connection to claude.ai — no API key required. Once connected, pick Claude's Opus / Sonnet / Haiku models right in your conversations.

</div>

---

## What it does

If you already have a **Claude Pro / Max subscription** and use **DeepSeek Harness web** day-to-day, this plugin lets you switch models in the same interface:

- **Settings → Subscriptions**: one click, authorize with your claude.ai account in the browser — no API key involved;
- Once connected, Claude models show up in the **model picker** next to the input box (or `/model`) — select one and the agent works with Claude, whether it's code, writing, or analysis;
- The **model list is fetched from Anthropic automatically** after you connect, and can be refreshed from the Subscriptions tab — no manual model configuration;
- **Image input** is supported: attach a screenshot or image and Claude reads it;
- Connection status, account info, and disconnect all live in the Subscriptions tab;
- No subscription? A plain **Anthropic API key** is supported as a fallback.

> It only adds an **optional model provider** to dsh web — your existing DeepSeek setup is untouched, and you can switch back anytime from the model picker.

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

1. Open dsh web, go to **Settings → Subscriptions**;
2. Click **Connect Claude subscription** — the browser opens the claude.ai authorization page; sign in and approve;
3. Back in dsh web, the tab shows **Connected via OAuth** along with your account;
4. Start or continue a conversation, open the model picker next to the input box (or type `/model`), and choose a Claude model:

```
/model claude-sonnet-4-5
```

The agent now works with that model. To disconnect, go back to the Subscriptions tab and click **Disconnect** (this clears the locally stored tokens).

## FAQ

**I clicked Connect but it keeps saying "Waiting for authorization…"**
Your browser probably blocked the pop-up — check whether pop-ups are allowed. If the login isn't finished within 5 minutes, the flow cancels itself; just click again.

**The tab says connected, but no Claude models in the picker?**
Make sure the Subscriptions tab really shows connected; restart dsh web once, then search `claude` in `/model`.

**401 / token expired while using it?**
The plugin auto-refreshes with the refresh token and falls back to Anthropic's token-exchange when needed; if failures persist, log in again from the Subscriptions tab.

**Which Claude models can I use?**
Depends on your plan. By default: `claude-opus-4-1`, `claude-sonnet-4-5`, `claude-haiku-4-5`; you can customize the list in configuration (below).

**Does it support images / vision?**
Yes. Attach images (PNG / JPEG / WebP / GIF) to a message and the plugin sends them to Claude as base64 image blocks.

**Will this affect my existing DeepSeek models?**
Not at all. It only adds a provider; switch between them freely.

## Advanced: custom model list (optional)

The model list refreshes automatically after you connect (and via the **Refresh model list** button in the Subscriptions tab). If you want to override it by hand, add an `llm-claude` section to `$DSH_HOME\settings.yaml`:

```yaml
llm-claude:
  reasoningEffort: high          # off | high | max, thinking intensity
  maxTokens: 32000
  defaultContextWindow: 200000
  models:
    - id: claude-sonnet-4-5
      name: Claude Sonnet 4.5
      contextWindow: 200000
      maxTokens: 32000
```

> The model list is advisory: the Anthropic endpoint accepts any model id it knows, so unlisted models work too.

## How it works (for the curious)

- **Login**: the same **OAuth PKCE** flow Claude Code uses — the plugin runs a loopback callback port locally; after you authorize at claude.ai, tokens are stored in `$DSH_HOME/.credentials.yaml`;
- **Calls**: the plugin streams requests to the Anthropic Messages API, with full tool-call, extended-thinking, and image support (thinking shows up as reasoning blocks);
- **Integration**: the plugin registers `claude-subscription` as an LLM provider for dsh web, so the model picker and `/model` recognize it directly.

## Development

```bash
pnpm install
node scripts/smoke.mjs                # wire protocol / config unit tests
node scripts/oauth-roundtrip-test.mjs # OAuth callback flow (network mocked)
node scripts/host-boot-test.mjs       # host plugin wiring test
node scripts/client-boot-test.mjs     # browser bundle boot test
```

## License

[MIT](LICENSE)

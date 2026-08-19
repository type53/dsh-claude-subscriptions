<div align="center">

# Claude for DeepSeek Harness

**Already paying for Claude Pro or Max? Use it inside DSH — no API key, no second bill.**

[简体中文](README.zh.md) · English

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

</div>

---

## What this is

DeepSeek Harness lets you choose which AI model answers you. This plugin adds **Claude** to that list, signed in with the Claude account you already have.

You click one button, log in at claude.ai the way you always do, and Claude appears in your model picker alongside everything else. There's no API key to create, no card to enter, and no per-message meter running — it uses the subscription you're already paying for.

Switching models is per-conversation. Ask Claude to review a diff, then switch straight back to DeepSeek for the next question.

## Is this for you?

**A good fit if you…**

- have a **Claude Pro or Max** subscription
- run **DeepSeek Harness web** (`dsh --profile web`)
- want to try Claude on a task without setting up billing anywhere

**Also works if you…**

- have no subscription but do have an **Anthropic API key** — the plugin accepts one as a fallback (that route bills per use)

**You can stop reading if you…**

- only use the DSH terminal app — this plugin is for the web interface

## What you get

| | |
|---|---|
| 🔑 **No API key** | Log in through claude.ai, the same as on the website |
| 🔀 **Switch anytime** | Claude sits next to your existing models; pick per conversation |
| 📋 **Models stay current** | The list is fetched from Anthropic after you connect, so new releases show up on their own |
| 🖼️ **Send images** | Drop in a screenshot and Claude reads it |
| 🧰 **Full agent support** | Tools, file edits, and Claude's step-by-step thinking all work |
| 🔒 **Stays on your machine** | Your login is stored locally, and you can disconnect at any time |

> This only **adds** a model. Nothing about your existing DeepSeek setup changes, and you can switch back whenever you like.

## Install

**Before you start**, make sure DSH web runs (`dsh --profile web`) and that you have Node.js 20 or newer plus pnpm.

### The easy way

Once the plugin is on npm, this is the whole install:

```bash
dsh plugin --profile web add dsh-claude-subscriptions
```

### From source (what to use today)

Not on npm yet, so link it manually. Three steps:

```powershell
# 1) Grab the code — any folder you like
git clone https://github.com/type53/dsh-claude-subscriptions.git
cd dsh-claude-subscriptions
pnpm install
```

**2)** Open `%USERPROFILE%\.dsh\profiles\web\package.json` in an editor and make two small additions:

- add `"dsh-claude-subscriptions"` to the `dsh.profile.bundles` list
- add `"dsh-claude-subscriptions": "link:<the folder from step 1>"` to `dependencies`

Then install so DSH picks it up:

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install
```

**3)** Restart DSH web:

```powershell
dsh --profile web
```

> Changed your `DSH_HOME`? Use `$DSH_HOME\profiles\web` instead of the path above.

## Connect your account

This takes about a minute, once.

1. In DSH web, open **Settings → Subscriptions**
2. Click **Connect Claude subscription**
3. A tab opens at claude.ai — sign in and approve. If Claude emails you a verification code, enter it there
4. Come back to DSH. The tab now reads **Connected via OAuth** and shows your account

That's it. You won't need to do this again unless you disconnect.

> **No tab opened?** Your browser blocked it. A link appears on the Subscriptions tab — click that instead, and the rest is identical.

## Using Claude

Open the model picker next to the message box, or type `/model`, and choose a Claude model:

```
/model claude-sonnet-5
```

From then on that conversation runs on Claude. Which models you see depends on your plan; the defaults are **Opus 5**, **Sonnet 5**, and **Haiku 4.5**, and the full list refreshes itself after you connect.

To stop using it, go back to **Settings → Subscriptions** and click **Disconnect**. That erases the stored login from your machine.

## Troubleshooting

**It's stuck on "Waiting for authorization…"**

The claude.ai login has a few steps — email, then sometimes a verification code. DSH waits until you've finished all of them, so this message is normal for a minute or two. Finish the steps in the Claude tab and this page switches to connected by itself. After 10 minutes it gives up and you can just click Connect again.

**No tab opened when I clicked Connect**

Your browser blocked the pop-up. The Subscriptions tab shows a link when that happens — click it to open the same page manually. Allowing pop-ups for DSH avoids it next time.

**It says connected, but I don't see Claude in the model picker**

Restart DSH web once, then type `/model` and search for `claude`. The picker reads its list at startup.

**I got a 401, or it says my login expired**

The plugin renews your login on its own in the background. If it keeps failing, the simplest fix is Disconnect and then Connect again from the Subscriptions tab.

**Will this mess up my DeepSeek models?**

No. It adds one more option to the picker and leaves everything else alone.

**Where is my login stored?**

In `$DSH_HOME/.credentials.yaml` on your own machine — nowhere else. Disconnect deletes it.

## Optional settings

You don't need any of this — the defaults are fine, and the model list keeps itself up to date. But if you want to pin an exact list or change how hard Claude thinks, add an `llm-claude` section to `$DSH_HOME\settings.yaml`:

```yaml
llm-claude:
  reasoningEffort: high          # off | high | max — how long Claude thinks before answering
  maxTokens: 32000               # longest reply, in tokens
  defaultContextWindow: 200000   # fallback size for models not listed below
  models:
    - id: claude-sonnet-5
      name: Claude Sonnet 5
      contextWindow: 1000000
      maxTokens: 32000
```

> The list is a suggestion, not a limit — any model id Anthropic recognizes works, even if it isn't listed here.

## How it works

For the curious:

- **Signing in** uses OAuth with PKCE, the same flow the Claude Code CLI uses. The plugin briefly listens on a local port to catch the redirect back from claude.ai, then stores the tokens in `$DSH_HOME/.credentials.yaml`.
- **Messages** are streamed to Anthropic's Messages API, with support for tool calls, extended thinking, and images.
- **Inside DSH**, the plugin registers a model provider called `claude-subscription`, which is why the picker and `/model` find it without extra setup.

## Development

```bash
pnpm install
node scripts/smoke.mjs                # request building, streaming, config
node scripts/oauth-roundtrip-test.mjs # the login callback flow (network mocked)
node scripts/host-boot-test.mjs       # plugin wiring on the DSH side
node scripts/client-boot-test.mjs     # settings-page bundle
```

## License

[MIT](LICENSE)

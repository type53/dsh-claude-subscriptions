<div align="center">

# Claude for DeepSeek Harness

**Use Anthropic's Claude models in DeepSeek Harness web.**

[简体中文](README.zh.md) · English

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

</div>

---

## Overview

This plugin adds Claude to DeepSeek Harness web as a model provider, so you can pick Opus, Sonnet, or Haiku from the model picker alongside your existing models.

Authentication uses whichever supported credential your machine already has: an API key you save in the settings tab, `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in your environment, or a browser sign-in through Anthropic's CLI. Model selection is per conversation, so you can use Claude for one task and return to DeepSeek for the next.

> **Billing.** Both methods bill as Anthropic API usage, charged per token to your Anthropic account. Neither draws on a Claude Pro or Max subscription — Anthropic does not offer a way for third-party applications to spend a consumer subscription.

## Requirements

- An **Anthropic account** with API access, at [console.anthropic.com](https://console.anthropic.com).
- **DeepSeek Harness web**, started with `dsh --profile web`.
- **Node.js 20 or later**, and pnpm.
- Optionally, **Anthropic's CLI** if you would rather sign in through a browser than paste a key.

This plugin targets the web interface. The terminal application is not supported.

## Features

| | |
|---|---|
| **Two ways to authenticate** | A saved API key, or a browser sign-in via `ant auth login` |
| **Picks up your environment** | `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are used automatically if set |
| **Self-updating model list** | The catalog is retrieved from Anthropic, so new releases appear automatically |
| **Image input** | Screenshots and images can be sent directly to Claude |
| **Full agent support** | Tool calls, file edits, and extended thinking are all supported |
| **Local credentials** | A saved key is stored on your machine and can be removed at any time |

Installing this plugin only adds a model provider. Existing DeepSeek configuration is unaffected.

## Installation

### From npm

Once the plugin is published to npm, installation is a single command:

```bash
dsh plugin --profile web add dsh-claude-subscriptions
```

### From source

The plugin is not yet published to npm. Until it is, link it from source.

**1.** Clone the repository into any directory and install its dependencies:

```powershell
git clone https://github.com/type53/dsh-claude-subscriptions.git
cd dsh-claude-subscriptions
pnpm install
```

**2.** Open `%USERPROFILE%\.dsh\profiles\web\package.json` and make two additions:

- add `"dsh-claude-subscriptions"` to the `dsh.profile.bundles` array
- add `"dsh-claude-subscriptions": "link:<the directory from step 1>"` to `dependencies`

Then install so that DSH resolves the link:

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install
```

**3.** Restart DSH web:

```powershell
dsh --profile web
```

If `DSH_HOME` has been changed from its default, substitute `$DSH_HOME\profiles\web` for the path above.

## Setting up credentials

Pick either method. The plugin tries them in a fixed order and uses the first one it finds, so having both configured is fine.

### Option 1: API key

1. Create a key at [console.anthropic.com](https://console.anthropic.com).
2. In DSH web, open **Settings → Claude**.
3. Paste the key into the **API key** field and select **Save**.

The key is stored in your machine's local credential store, not in the settings file.

### Option 2: Browser sign-in

If you would rather not handle a key directly, install [Anthropic's CLI](https://platform.claude.com/docs/en/api/sdks/cli) and run:

```bash
ant auth login
```

A browser opens for sign-in. You only do this once — the CLI stores a profile locally, and the plugin asks it for a short-lived token when needed. Nothing is pasted into DSH.

### Confirming it works

Open **Settings → Claude** and select **Test connection**. It resolves a credential and makes a real request, so a success there means conversations will work too. The Connection card then shows which credential is in use.

## Using Claude

Open the model picker beside the message box, or type `/model`, and select a Claude model:

```
/model claude-sonnet-5
```

That conversation then runs on Claude. The defaults are **Opus 5**, **Sonnet 5**, and **Haiku 4.5**, and the full list refreshes from Anthropic once a credential is configured.

## Troubleshooting

**Test connection reports no credential found**

Nothing was found in any supported location. Either save an API key in the settings tab, or run `ant auth login` and test again. If you set `ANTHROPIC_API_KEY` in a shell after starting DSH, restart DSH — the environment is captured at launch.

**Requests fail with 401**

The credential was found but rejected. For an API key, confirm it is active in the Anthropic console. For a CLI login, run `ant auth status` to check which profile is active; a stale profile is fixed by running `ant auth login` again.

**The Subscriptions tab is gone**

It is now **Settings → Claude**. The subscription login flow was removed in 0.4.0; see the note below.

**Claude does not appear in the model picker**

Restart DSH web, then type `/model` and search for `claude`. The picker reads its catalog at startup.

**Does this affect existing DeepSeek models?**

No. It adds one option to the model picker and leaves the rest of the configuration untouched.

## Configuration (optional)

No configuration is required. The defaults are suitable for most use, and the model list keeps itself current. To pin a specific list or adjust how long Claude reasons before answering, add an `llm-claude` section to `$DSH_HOME\settings.yaml`:

```yaml
llm-claude:
  reasoningEffort: high          # off | high | max — how long Claude reasons before answering
  maxTokens: 32000               # maximum reply length, in tokens
  defaultContextWindow: 200000   # fallback context size for models not listed below
  models:
    - id: claude-sonnet-5
      name: Claude Sonnet 5
      contextWindow: 1000000
      maxTokens: 32000
```

The list is advisory rather than restrictive: any model identifier Anthropic recognizes will work, including those not listed here.

## A note on 0.4.0

Earlier versions connected to claude.ai with an OAuth flow that reused Claude Code's client identifier, which let a Claude Pro or Max subscription be spent from DSH. That is not something Anthropic offers to third-party applications, and the flow depended on presenting another product's identity to the authorization server, so it was removed in 0.4.0 in favour of the two supported methods above.

The practical difference is billing: usage is now charged to your Anthropic API account rather than covered by a subscription. If you were relying on the old behaviour, that change is real and worth knowing before you upgrade.

## How it works

- **Credentials** are resolved per request, in the order Anthropic's own SDKs use: a key saved in the settings tab, then `ANTHROPIC_API_KEY`, then `ANTHROPIC_AUTH_TOKEN`, then a profile from `ant auth login`. The CLI is invoked only if the earlier sources come up empty, and its absence is not an error.
- **Requests** are streamed to Anthropic's Messages API with support for tool calls, extended thinking, and image input. An API key is sent in `x-api-key`; a CLI or environment token is sent as a bearer token with the `oauth-2025-04-20` beta header.
- **Integration** registers a model provider named `claude-subscription`, which is how the model picker and `/model` locate it without further configuration.

## Development

```bash
pnpm install
node scripts/smoke.mjs                # request building, streaming, credentials, config
node scripts/host-boot-test.mjs       # plugin wiring on the DSH side
node scripts/client-boot-test.mjs     # settings-page bundle and locale dictionaries
```

## License

[MIT](LICENSE)

<div align="center">

# Claude for DeepSeek Harness

**Use an existing Claude Pro or Max subscription inside DeepSeek Harness web — no API key required.**

[简体中文](README.zh.md) · English

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

</div>

---

## Overview

DeepSeek Harness lets you choose which model handles a conversation. This plugin adds Claude to that list, authenticated with the Claude account you already have.

Connecting takes a single click and a standard claude.ai login. Claude then appears in the model picker alongside your existing models. No API key, payment details, or per-message billing is involved — requests run against the subscription you already hold.

Model selection is per conversation, so you can use Claude for one task and return to DeepSeek for the next.

## Requirements

- A **Claude Pro or Max** subscription. An Anthropic API key also works as a fallback, though that route is billed per use.
- **DeepSeek Harness web**, started with `dsh --profile web`.
- **Node.js 20 or later**, and pnpm.

This plugin targets the web interface. The terminal application is not supported.

## Features

| | |
|---|---|
| **No API key** | Authentication uses a standard claude.ai login |
| **Switch at any time** | Claude sits alongside your existing models and is selected per conversation |
| **Self-updating model list** | The catalog is retrieved from Anthropic on connection, so new releases appear automatically |
| **Image input** | Screenshots and images can be sent directly to Claude |
| **Full agent support** | Tool calls, file edits, and extended thinking are all supported |
| **Local credentials** | Login details are stored on your machine and can be removed at any time |

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

## Connecting your account

This is a one-time setup.

1. In DSH web, open **Settings → Subscriptions**.
2. Select **Connect Claude subscription**.
3. A tab opens at claude.ai. Sign in and approve the request. If Claude sends a verification code by email, enter it on that page.
4. Return to DSH. The Subscriptions tab now reads **Connected via OAuth** and displays your account.

The connection persists until you disconnect.

> If no tab opens, the browser has blocked it. A link appears on the Subscriptions tab in that case; opening it manually produces the same result.

## Using Claude

Open the model picker beside the message box, or type `/model`, and select a Claude model:

```
/model claude-sonnet-5
```

That conversation then runs on Claude. The models available depend on your plan; the defaults are **Opus 5**, **Sonnet 5**, and **Haiku 4.5**, and the full list refreshes automatically once connected.

To disconnect, return to **Settings → Subscriptions** and select **Disconnect**, which removes the stored credentials from your machine.

## Troubleshooting

**The page remains on "Waiting for authorization…"**

The claude.ai login involves several steps — an email address, and sometimes a verification code. DSH waits until all of them are complete, so this message is expected for a minute or two. Complete the remaining steps in the Claude tab and the page will change to connected on its own. After ten minutes the attempt is abandoned and can be started again.

**No tab opens after selecting Connect**

The browser has blocked the pop-up. A link appears on the Subscriptions tab in this case, which opens the same page. Allowing pop-ups for DSH prevents it recurring.

**The Subscriptions tab reports connected, but Claude does not appear in the model picker**

Restart DSH web, then type `/model` and search for `claude`. The picker reads its catalog at startup.

**Requests fail with 401, or the login is reported as expired**

Credentials are renewed automatically in the background. If failures persist, disconnect and reconnect from the Subscriptions tab.

**Does this affect existing DeepSeek models?**

No. It adds one option to the model picker and leaves the rest of the configuration untouched.

**Where are credentials stored?**

In `$DSH_HOME/.credentials.yaml` on your own machine, and nowhere else. Disconnecting deletes them.

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

The list is advisory rather than restrictive: any model identifier Anthropic recognises will work, including those not listed here.

## How it works

- **Authentication** uses OAuth with PKCE, the same flow as the Claude Code CLI. The plugin listens briefly on a local port to receive the redirect back from claude.ai, then stores the resulting tokens in `$DSH_HOME/.credentials.yaml`.
- **Requests** are streamed to Anthropic's Messages API, with support for tool calls, extended thinking, and image input.
- **Integration** registers a model provider named `claude-subscription`, which is how the model picker and `/model` locate it without further configuration.

## Development

```bash
pnpm install
node scripts/smoke.mjs                # request building, streaming, config
node scripts/oauth-roundtrip-test.mjs # login callback flow (network mocked)
node scripts/host-boot-test.mjs       # plugin wiring on the DSH side
node scripts/client-boot-test.mjs     # settings-page bundle
```

## License

[MIT](LICENSE)

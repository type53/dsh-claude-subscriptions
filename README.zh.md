<div align="center">

# Claude for DeepSeek Harness

**在 DeepSeek Harness web 中使用 Anthropic 的 Claude 模型。**

[English](README.md) · 简体中文

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

</div>

---

## 简介

本插件把 Claude 作为一个模型提供方加入 DeepSeek Harness web，你可以在模型选择器里和现有模型一样选用 Opus、Sonnet 或 Haiku。

认证会使用你机器上已有的任意一种受支持的凭据：在设置页保存的 API Key、环境变量 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`，或者通过 Anthropic CLI 完成的浏览器登录。模型是按会话选择的，所以你可以用 Claude 处理一项任务，下一项再切回 DeepSeek。

> **计费说明。** 两种方式都按 Anthropic 的 API 用量计费，从你的 Anthropic 账户按 token 扣费，不会走 Claude Pro / Max 订阅 —— Anthropic 并未向第三方应用开放用消费者订阅付费的方式。

## 环境要求

- 一个开通了 API 访问的 **Anthropic 账号**，见 [console.anthropic.com](https://console.anthropic.com)。
- **DeepSeek Harness web**，通过 `dsh --profile web` 启动。
- **Node.js 20 或更高版本**，以及 pnpm。
- 可选：**Anthropic CLI**，如果你更想用浏览器登录而不是粘贴密钥。

本插件面向 web 界面，不支持终端版应用。

## 功能

| | |
|---|---|
| **两种认证方式** | 保存的 API Key，或通过 `ant auth login` 的浏览器登录 |
| **自动读取环境变量** | 已设置的 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN` 会被自动使用 |
| **模型列表自动更新** | 从 Anthropic 获取目录，新发布的模型会自动出现 |
| **支持图片输入** | 截图与图片可直接发送给 Claude |
| **完整的 agent 能力** | 支持工具调用、文件修改与 extended thinking |
| **凭据保存在本机** | 保存的密钥存在你的电脑上，可以随时清除 |

安装本插件只是新增一个模型提供方，不会影响你现有的 DeepSeek 配置。

## 安装

### 通过 npm 安装

插件发布到 npm 后，一条命令即可完成安装：

```bash
dsh plugin --profile web add dsh-claude-subscriptions
```

### 从源码安装

插件尚未发布到 npm，在此之前请从源码链接安装。

**1.** 将仓库克隆到任意目录并安装依赖：

```powershell
git clone https://github.com/type53/dsh-claude-subscriptions.git
cd dsh-claude-subscriptions
pnpm install
```

**2.** 打开 `%USERPROFILE%\.dsh\profiles\web\package.json`，添加两处内容：

- 在 `dsh.profile.bundles` 数组中加入 `"dsh-claude-subscriptions"`
- 在 `dependencies` 中加入 `"dsh-claude-subscriptions": "link:<第 1 步的目录路径>"`

然后执行安装，让 DSH 解析这个链接：

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install
```

**3.** 重启 DSH web：

```powershell
dsh --profile web
```

如果 `DSH_HOME` 不是默认值，请把上面的路径换成 `$DSH_HOME\profiles\web`。

## 配置凭据

两种方式选其一即可。插件会按固定顺序依次尝试，用找到的第一个，所以两种都配置也没有问题。

### 方式一：API Key

1. 在 [console.anthropic.com](https://console.anthropic.com) 创建一个 API Key。
2. 在 DSH web 中打开 **设置 → Claude**。
3. 把密钥粘贴到 **API Key** 输入框，点击**保存**。

密钥保存在你本机的凭据库中，不会写进设置文件。

### 方式二：浏览器登录

如果你不想直接接触密钥，可以安装 [Anthropic CLI](https://platform.claude.com/docs/en/api/sdks/cli)，然后运行：

```bash
ant auth login
```

浏览器会打开登录页。登录一次即可 —— CLI 会把账号信息保存在本地，插件需要时向它要一个短期令牌，不需要往 DSH 里粘贴任何东西。

### 确认是否可用

打开 **设置 → Claude**，点击**测试连接**。它会真的解析一次凭据并发起一次请求，所以这里成功就意味着对话也能用。之后「连接状态」卡片会显示当前使用的是哪一种凭据。

## 使用 Claude

在输入框旁打开模型选择器，或输入 `/model`，选择一个 Claude 模型：

```
/model claude-sonnet-5
```

之后这个会话就由 Claude 处理。默认是 **Opus 5**、**Sonnet 5** 和 **Haiku 4.5**，配置好凭据后完整列表会从 Anthropic 刷新。

## 疑难排查

**测试连接提示没有找到凭据**

说明所有受支持的位置里都没有找到。可以在设置页保存一个 API Key，或者运行 `ant auth login` 后再测一次。如果你是在 DSH 启动之后才设置的 `ANTHROPIC_API_KEY`，请重启 DSH —— 环境变量是在启动时读取的。

**请求返回 401**

说明找到了凭据但被拒绝了。如果用的是 API Key，请在 Anthropic 控制台确认它仍然有效；如果用的是 CLI 登录，运行 `ant auth status` 看看当前是哪个 profile，profile 过期的话重新运行 `ant auth login` 即可。

**「订阅」页不见了**

现在叫 **设置 → Claude**。订阅登录流程在 0.4.0 中已移除，原因见下方说明。

**模型选择器里没有 Claude**

重启 DSH web，然后输入 `/model` 并搜索 `claude`。选择器在启动时读取模型目录。

**会影响我现有的 DeepSeek 模型吗？**

不会。它只是在模型选择器中增加一个选项，其余配置保持不变。

## 配置（可选）

不需要任何配置就能使用。默认值适用于大多数场景，模型列表也会自动保持更新。如果想固定某一份列表，或者调整 Claude 回答前的思考强度，可以在 `$DSH_HOME\settings.yaml` 里添加一段 `llm-claude` 配置：

```yaml
llm-claude:
  reasoningEffort: high          # off | high | max —— 回答前的思考强度
  maxTokens: 32000               # 单次回复的最大长度（token）
  defaultContextWindow: 200000   # 未在下方列出的模型所用的上下文大小
  models:
    - id: claude-sonnet-5
      name: Claude Sonnet 5
      contextWindow: 1000000
      maxTokens: 32000
```

这份列表只是建议，并不是限制：只要是 Anthropic 能识别的模型 id 都可以使用，包括没有列在这里的模型。

## 关于 0.4.0

早期版本通过一套 OAuth 流程连接 claude.ai，其中复用了 Claude Code 的 client id，从而可以在 DSH 中消耗 Claude Pro / Max 订阅。Anthropic 并未向第三方应用提供这种能力，而这套流程依赖于向授权服务器出示另一个产品的身份，因此在 0.4.0 中被移除，改为上面两种受支持的方式。

实际差别在于计费：现在的用量会从你的 Anthropic API 账户扣费，而不再由订阅覆盖。如果你之前依赖的正是旧行为，这个变化是真实存在的，升级前值得先了解清楚。

## 工作原理

- **凭据**在每次请求时解析，顺序与 Anthropic 官方 SDK 一致：先是设置页保存的密钥，然后是 `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`，最后是 `ant auth login` 的 profile。只有前面几种都没有时才会调用 CLI，CLI 不存在也不会报错。
- **请求**以流式方式发送至 Anthropic Messages API，支持工具调用、extended thinking 与图片输入。API Key 通过 `x-api-key` 发送；CLI 或环境变量提供的令牌则作为 bearer token 发送，并带上 `oauth-2025-04-20` beta 头。
- **集成**方面，插件注册了名为 `claude-subscription` 的模型提供方，模型选择器与 `/model` 因此无需额外配置即可识别它。

## 开发

```bash
pnpm install
node scripts/smoke.mjs                # 请求构造、流式解析、凭据、配置
node scripts/host-boot-test.mjs       # DSH 侧插件接线
node scripts/client-boot-test.mjs     # 设置页 bundle 与语言词典
```

## 许可证

[MIT](LICENSE)

<div align="center">

# Claude for DeepSeek Harness

**在 DeepSeek Harness web 中直接使用你的 Claude 订阅 —— 无需 API Key。**

[English](README.md) · 简体中文

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

</div>

---

## 简介

本插件让你直接使用自己的 Claude 订阅，无需 API Key。

DeepSeek Harness 允许你选择由哪个模型来处理会话，本插件把 Claude 加入这个列表，并使用你已有的 Claude 账号完成认证。连接只需点击一次并完成常规的 claude.ai 登录，之后 Claude 就会和你现有的模型一起出现在模型选择器里。整个过程不涉及 API Key、支付信息或按条计费 —— 请求使用的是你已经持有的订阅。

模型是按会话选择的，所以你可以用 Claude 处理一项任务，下一项再切回 DeepSeek。

## 环境要求

- **Claude Pro 或 Max** 订阅。也可使用 Anthropic API Key 作为备用方式，但该方式按用量计费。
- **DeepSeek Harness web**，通过 `dsh --profile web` 启动。
- **Node.js 20 或更高版本**，以及 pnpm。

本插件面向 web 界面，不支持终端版应用。

## 功能

| | |
|---|---|
| **无需 API Key** | 使用常规的 claude.ai 登录完成认证 |
| **随时切换** | Claude 与现有模型并列，按会话选择 |
| **模型列表自动更新** | 连接后从 Anthropic 获取目录，新发布的模型会自动出现 |
| **支持图片输入** | 截图与图片可直接发送给 Claude |
| **完整的 agent 能力** | 支持工具调用、文件修改与 extended thinking |
| **凭据保存在本机** | 登录信息保存在你的电脑上，可以随时清除 |

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

## 连接账号

这是一次性的配置。

1. 在 DSH web 中打开 **设置 → 订阅**。
2. 点击 **连接 Claude 订阅**。
3. 浏览器会打开 claude.ai 页面。登录并同意授权；如果 Claude 通过邮件发了验证码，请在那个页面填写。
4. 返回 DSH。「订阅」页会显示**已通过 OAuth 连接**和你的账号。

这个连接会一直保持，直到你主动断开。

> 如果没有打开新标签页，说明浏览器拦截了弹窗。这时「订阅」页会显示一个链接，手动打开可以得到相同的结果。

## 使用 Claude

在输入框旁打开模型选择器，或输入 `/model`，选择一个 Claude 模型：

```
/model claude-sonnet-5
```

之后这个会话就由 Claude 处理。可用的模型取决于你的订阅套餐，默认是 **Opus 5**、**Sonnet 5** 和 **Haiku 4.5**，完整列表在连接后会自动刷新。

想要断开，请回到 **设置 → 订阅** 并点击**断开连接**，本机保存的凭据会被清除。

## 疑难排查

**页面一直停留在「正在等待授权…」**

claude.ai 的登录包含多个步骤 —— 填写邮箱，有时还需要输入验证码。DSH 会等待全部步骤完成，所以这条提示持续一两分钟是正常的。在 Claude 页面里完成剩下的步骤后，这一页会自动变成已连接。超过十分钟没有完成，本次尝试会被取消，可以重新发起。

**点击「连接」后未打开新标签页**

浏览器拦截了弹窗。这时「订阅」页会显示一个链接，可以打开同一个页面。给 DSH 允许弹窗就能避免再次出现。

**「订阅」页显示已连接，但模型选择器中没有 Claude**

重启 DSH web，然后输入 `/model` 并搜索 `claude`。选择器在启动时读取模型目录。

**请求返回 401，或提示登录已过期**

凭据会在后台自动续期。如果一直失败，请在「订阅」页断开连接后重新连接。

**会影响我现有的 DeepSeek 模型吗？**

不会。它只是在模型选择器中增加一个选项，其余配置保持不变。

**凭据保存在哪里？**

保存在你电脑上的 `$DSH_HOME/.credentials.yaml` 里，不会放到其他地方。断开连接时会一并删除。

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

## 工作原理

- **认证**采用 OAuth PKCE 流程，与 Claude Code CLI 相同。插件会在本地端口短暂监听，以接收 claude.ai 授权后的跳转，并将所得令牌存入 `$DSH_HOME/.credentials.yaml`。
- **请求**以流式方式发送至 Anthropic Messages API，支持工具调用、extended thinking 与图片输入。
- **集成**方面，插件注册了名为 `claude-subscription` 的模型提供方，模型选择器与 `/model` 因此无需额外配置即可识别它。

## 开发

```bash
pnpm install
node scripts/smoke.mjs                # 请求构造、流式解析、配置
node scripts/oauth-roundtrip-test.mjs # 登录回调链路（网络已 mock）
node scripts/host-boot-test.mjs       # DSH 侧插件接线
node scripts/client-boot-test.mjs     # 设置页 bundle
```

## 许可证

[MIT](LICENSE)

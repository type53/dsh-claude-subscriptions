<div align="center">

# dsh-claude-subscriptions

**在 DeepSeek Harness web 里直接用你的 Claude 订阅（Pro / Max）**

English · [简体中文](README.zh.md)

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

复用你的 Claude 订阅（Pro / Max）：插件直接读取你本机的 **Claude Code 登录状态**，或使用 **`claude setup-token`** 生成的令牌。连接后对话中即可选用 Claude 的 Opus / Sonnet / Haiku 等模型。

</div>

---

## 它能做什么

如果你**已经有 Claude Pro / Max 订阅**，并且平时用 **DeepSeek Harness web** 干活，这个插件能让你在同一个界面里按需切换模型：

- **设置 → 订阅**：直接显示你当前的订阅状态（账号、订阅类型、限流档位），读取自 **Claude Code 登录**（`~/.claude/.credentials.json`），无需弹窗登录；
- 没有 Claude Code 登录？把 **`claude setup-token`** 输出的令牌粘贴到「订阅」页即可（这是官方支持的"在 Claude Code 之外使用订阅"的方式）；
- 有可用令牌后，会话输入框旁的**模型选择器**（或 `/model`）里会出现 Claude 模型，选中即可让 agent 用 Claude 执行任务；
- **模型列表会自动从 Anthropic 拉取**（也能在「订阅」页手动刷新）；
- **支持图片输入**：贴一张截图或图片，Claude 能直接读取；
- 没有订阅？也支持直接填 **Anthropic API Key** 作为备用。

> 它只是给 dsh web **新增一个可选的模型提供方**，不影响你现有的 DeepSeek 使用，随时可以在模型选择器里切回。

> ⚠️ **使用条款提示**：订阅令牌仅供**个人**使用。轻量、人工节奏地使用自己的登录是这类工具的常态；大量或自动化调用存在被 Anthropic 限流甚至封号的风险，请自行斟酌。

## 安装

**前置条件**：已安装并运行 DeepSeek Harness web（`dsh --profile web`），本机有 Node.js 20+ 与 pnpm。

### 方式一：npm 一键安装（推荐）

插件发布到 npm 后，一条命令即可：

```bash
dsh plugin --profile web add dsh-claude-subscriptions
```

### 方式二：手动链接（npm 尚未发布时）

```powershell
# 1) 克隆到本地任意目录
git clone https://github.com/type53/dsh-claude-subscriptions.git
cd dsh-claude-subscriptions
pnpm install

# 2) 把插件挂进 web profile
#    打开 $env:USERPROFILE\.dsh\profiles\web\package.json，做两处修改：
#    a) 在 dsh.profile.bundles 数组里追加 "dsh-claude-subscriptions"
#    b) 在 dependencies 里追加 "dsh-claude-subscriptions": "link:<第 1 步的绝对路径>"
#    然后安装：
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install

# 3) 重启 dsh web
dsh --profile web
```

> 如果你的 `DSH_HOME` 不是默认的 `%USERPROFILE%\.dsh`，把上面第 2 步的路径换成你自己的 `$DSH_HOME\profiles\web` 即可。

## 快速开始

1. 确保本机已登录 Claude Code（`claude login`），或运行 `claude setup-token` 拿到令牌；
2. 打开 dsh web，进入 **设置 → 订阅** —— 页面会显示**已检测到 Claude Code 登录**（或提供**粘贴 setup-token** 输入框）；
3. 如果令牌已过期，插件会自动续期（并把新令牌写回，保证 Claude Code 本身不受影响）；
4. 新建或继续一个会话，在输入框旁打开模型选择器（或输入 `/model`），选一个 Claude 模型：

```
/model claude-sonnet-4-5
```

之后 agent 就用这个模型工作了。想停用粘贴的令牌，点「订阅」页的**清除令牌**即可。

## 常见问题

**「订阅」页显示「未检测到订阅凭据」？**
本机没有登录 Claude Code（或缺少 `~/.claude/.credentials.json`）。运行 `claude login` 后点**刷新状态**；或粘贴 `claude setup-token` 的令牌。

**Claude Code 提示「Re-authenticate to continue」？**
登录已过期或失效。在终端运行一次 `claude login`，插件的下一次请求会自动读取新登录。

**使用时报 401 / 令牌过期？**
插件会自动续期 Claude Code 令牌（轮换安全：新令牌会写回凭据文件）。如果续期失败，重新运行 `claude login`。

**「订阅」页有登录信息，但模型选择器里没有 Claude？**
重启一次 dsh web，再在 `/model` 里搜索 `claude`。

**能用哪些 Claude 模型？**
取决于你的订阅套餐。插件会自动从 Anthropic 拉取列表，你也可以在配置里覆盖（见下）。

**支持图片 / 视觉输入吗？**
支持。把图片（PNG / JPEG / WebP / GIF）附到消息里，插件会以 base64 图片块发给 Claude。

**会影响我原来的 DeepSeek 模型吗？**
完全不会。它只是新增一个模型提供方，两者可以随时切换。

## 进阶：自定义模型列表（可选）

模型列表会在连接后自动拉取（也可在「订阅」页点「刷新模型列表」）。如果你想手动覆盖，可以在 `$DSH_HOME\settings.yaml` 里加一段 `llm-claude` 配置：

```yaml
llm-claude:
  reasoningEffort: high          # off | high | max，思考强度
  maxTokens: 32000
  defaultContextWindow: 200000
  models:
    - id: claude-sonnet-4-5
      name: Claude Sonnet 4.5
      contextWindow: 200000
      maxTokens: 32000
```

> 模型列表只是建议目录：Anthropic 端点接受任何它认识的模型 id，列表里没有的模型也能直接用。

## 工作原理（给好奇的人）

- 凭据：插件每次请求都重新读取 Claude Code 登录文件 `~/.claude/.credentials.json`（`claudeAiOauth`），Claude Code 的令牌轮换会被自动感知；粘贴的 `claude setup-token` 令牌（存在 dsh 凭据接缝中）优先级更高；
- 续期：access token 过期时，插件在 `platform.claude.com/v1/oauth/token` 续期并把新令牌对写回文件（Anthropic 会轮换 refresh token，丢弃新令牌会弄坏登录），另有插件侧缓存兜底；
- 调用：插件用订阅令牌向 Anthropic Messages API 发起流式请求（`anthropic-beta: oauth-2025-04-20`），支持工具调用、extended thinking（思考内容会显示为 reasoning 块）与图片输入；
- 接入：插件把 `claude-subscription` 注册为 dsh web 的一个 LLM provider，所以模型选择器、`/model` 都能直接识别它。

## 开发

```bash
pnpm install
node scripts/smoke.mjs                # 线协议 / 配置 / 令牌来源单测
node scripts/host-boot-test.mjs       # 宿主插件接线测试
node scripts/client-boot-test.mjs     # 浏览器 bundle 引导测试
```

## 许可证

[MIT](LICENSE)

<div align="center">

# dsh-claude-subscriptions

**在 DeepSeek Harness web 里直接用你的 Claude 订阅（Pro / Max）**

English · [简体中文](README.zh.md)

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

OAuth 一键连接 claude.ai，无需 API Key；连接后对话中即可选用 Claude 的 Opus / Sonnet / Haiku 等模型。

</div>

---

## 它能做什么

如果你**已经有 Claude Pro / Max 订阅**，并且平时用 **DeepSeek Harness web** 干活，这个插件能让你在同一个界面里按需切换模型：

- **设置 → 订阅**：点一下按钮，浏览器里完成 claude.ai 授权登录，全程不需要 API Key；
- 连接后，会话输入框旁的**模型选择器**（或 `/model`）里会出现 Claude 模型，选中即可让 agent 用 Claude 执行任务（代码、写作、分析都可以）；
- **模型列表会自动从 Anthropic 拉取**（连接后自动更新，也能在「订阅」页手动刷新），无需手动配置模型；
- **支持图片输入**：贴一张截图或图片，Claude 能直接读取；
- 登录状态、账号信息、断开连接都在「订阅」页里一目了然；
- 没有订阅？也支持直接填 **Anthropic API Key** 作为备用。

> 它只是给 dsh web **新增一个可选的模型提供方**，不影响你现有的 DeepSeek 使用，随时可以在模型选择器里切回。

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

1. 打开 dsh web，进入 **设置 → 订阅**；
2. 点击 **连接 Claude 订阅**，浏览器会打开 claude.ai 的授权页，登录并同意；
3. 回到 dsh web，「订阅」页会显示**已通过 OAuth 连接**和你的账号；
4. 新建或继续一个会话，在输入框旁打开模型选择器（或输入 `/model`），选一个 Claude 模型：

```
/model claude-sonnet-4-5
```

之后 agent 就用这个模型工作了。想断开连接，回到「订阅」页点**断开连接**即可（会清掉本机保存的令牌）。

## 常见问题

**点击连接后一直显示「正在等待授权…」？**
浏览器弹窗可能被拦截了，检查一下浏览器是否允许弹窗；如果 5 分钟内没完成，页面会自动取消，重新点一次即可。

**「订阅」页显示已连接，但模型选择器里没有 Claude？**
先确认「订阅」页确实显示已连接；然后重启一次 dsh web，再在 `/model` 里搜索 `claude`。

**使用时报 401 / 令牌过期？**
插件会自动用 refresh token 续期，也会在必要时自动做 Anthropic 的 token-exchange 兜底；如果连续失败，到「订阅」页重新登录一次。

**能用哪些 Claude 模型？**
取决于你的订阅套餐。默认提供 `claude-opus-4-1`、`claude-sonnet-4-5`、`claude-haiku-4-5`，你也可以在配置里自定义列表（见下）。

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

- 登录：与 Claude Code 相同的 **OAuth PKCE** 流程——插件在本地起一个回环回调端口，你在 claude.ai 授权后令牌存进 `$DSH_HOME/.credentials.yaml`；
- 调用：插件向 Anthropic Messages API 发起流式请求，支持工具调用、extended thinking（思考内容会显示为 reasoning 块）与图片输入；
- 接入：插件把 `claude-subscription` 注册为 dsh web 的一个 LLM provider，所以模型选择器、`/model` 都能直接识别它。

## 开发

```bash
pnpm install
node scripts/smoke.mjs                # 线协议 / 配置单测
node scripts/oauth-roundtrip-test.mjs # OAuth 回调链路测试（网络已 mock）
node scripts/host-boot-test.mjs       # 宿主插件接线测试
node scripts/client-boot-test.mjs     # 浏览器 bundle 引导测试
```

## 许可证

[MIT](LICENSE)

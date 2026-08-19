<div align="center">

# Claude for DeepSeek Harness

**已经在为 Claude Pro / Max 付费了？直接在 DSH 里用起来 —— 不用 API Key，也不用再付一份钱。**

[English](README.md) · 简体中文

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-dsh%20web-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![provider](https://img.shields.io/badge/provider-Anthropic-orange)](https://www.anthropic.com)

</div>

---

## 这是什么

DeepSeek Harness 允许你自由选择用哪个模型来回答问题。这个插件把 **Claude** 也加进这个列表，用的就是你手上那个 Claude 账号。

点一个按钮，像平时那样在 claude.ai 登录一下，Claude 就会出现在模型选择器里，和其他模型并排。不用申请 API Key，不用绑卡，也没有按条计费的表在跑 —— 它走的是你本来就在付的那份订阅。

切换是按会话来的：让 Claude 看一遍 diff，下一个问题再切回 DeepSeek，随时都行。

## 你适合用吗

**很适合，如果你：**

- 有 **Claude Pro 或 Max** 订阅
- 在用 **DeepSeek Harness web**（`dsh --profile web`）
- 想拿 Claude 试试某个任务，又不想为此去开通计费

**也能用，如果你：**

- 没有订阅，但有 **Anthropic API Key** —— 插件支持用 Key 作为备用方式（这条路是按用量计费的）

**可以先关掉这页，如果你：**

- 只用 DSH 的终端版 —— 这个插件是给 web 界面用的

## 能得到什么

| | |
|---|---|
| 🔑 **不需要 API Key** | 走 claude.ai 登录，和你平时上网页一模一样 |
| 🔀 **随时切换** | Claude 就在你现有模型旁边，按会话选 |
| 📋 **模型列表自动更新** | 连接后从 Anthropic 拉取，出了新模型会自己出现 |
| 🖼️ **可以发图** | 丢一张截图进去，Claude 直接能看 |
| 🧰 **完整的 agent 能力** | 工具调用、改文件、Claude 的分步思考都正常工作 |
| 🔒 **数据留在本机** | 登录信息存在你自己电脑上，随时可以断开 |

> 它只是**多加一个模型**。你现有的 DeepSeek 配置一点都不会动，想切回去随时切。

## 安装

**开始之前**：确认 DSH web 能正常跑起来（`dsh --profile web`），本机装了 Node.js 20 或更高版本，以及 pnpm。

### 简单的方式

等插件发布到 npm 之后，一条命令就够了：

```bash
dsh plugin --profile web add dsh-claude-subscriptions
```

### 从源码安装（目前用这个）

还没发到 npm，所以先手动链接。三步：

```powershell
# 1) 把代码拉到任意目录
git clone https://github.com/type53/dsh-claude-subscriptions.git
cd dsh-claude-subscriptions
pnpm install
```

**2)** 用编辑器打开 `%USERPROFILE%\.dsh\profiles\web\package.json`，加两处内容：

- 在 `dsh.profile.bundles` 列表里加上 `"dsh-claude-subscriptions"`
- 在 `dependencies` 里加上 `"dsh-claude-subscriptions": "link:<第 1 步的目录绝对路径>"`

然后装一下，让 DSH 认到它：

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install
```

**3)** 重启 DSH web：

```powershell
dsh --profile web
```

> 改过 `DSH_HOME`？把上面的路径换成你自己的 `$DSH_HOME\profiles\web` 就行。

## 连接你的账号

一次性的事，大概一分钟。

1. 在 DSH web 里打开 **设置 → 订阅**
2. 点 **连接 Claude 订阅**
3. 会弹出一个 claude.ai 的标签页 —— 登录并同意授权。如果 Claude 给你发了邮箱验证码，在那个页面填进去
4. 回到 DSH，「订阅」页会显示**已通过 OAuth 连接**，还有你的账号

就这样。除非你主动断开，否则不用再来一次。

> **没弹出标签页？** 是被浏览器拦了。「订阅」页上会出现一个链接，点它就行，后面的步骤完全一样。

## 开始用

在输入框旁边打开模型选择器，或者直接输入 `/model`，选一个 Claude 模型：

```
/model claude-sonnet-5
```

之后这个会话就跑在 Claude 上了。具体能看到哪些模型取决于你的套餐，默认是 **Opus 5**、**Sonnet 5** 和 **Haiku 4.5**，完整列表在连接后会自己刷新。

不想用了就回到 **设置 → 订阅** 点**断开连接**，本机保存的登录信息会被清掉。

## 遇到问题

**一直卡在「正在等待授权…」**

claude.ai 的登录有好几步 —— 先填邮箱，有时还要输验证码。DSH 会一直等到你全部走完，所以停在这条提示上一两分钟是正常的。在 Claude 那个标签页里把步骤走完，这边会自己变成已连接。超过 10 分钟没完成的话它会放弃，重新点一次「连接」即可。

**点了连接，但没有弹出标签页**

浏览器把弹窗拦了。这种情况下「订阅」页会显示一个链接，点它就能打开同一个页面。给 DSH 允许弹窗，下次就不会了。

**显示已连接，但模型选择器里找不到 Claude**

重启一次 DSH web，然后输入 `/model` 搜 `claude`。选择器是在启动时读取列表的。

**用着用着报 401，或者提示登录过期**

插件会在后台自动续期。如果一直失败，最省事的办法是到「订阅」页点断开连接，再重新连一次。

**会影响我原来的 DeepSeek 模型吗？**

不会。它只是往选择器里多加一个选项，其他什么都不动。

**我的登录信息存在哪？**

在你自己电脑的 `$DSH_HOME/.credentials.yaml` 里，不会传到别处。点断开连接就会删掉。

## 可选配置

这些都不是必须的 —— 默认值就够用，模型列表也会自己保持最新。但如果你想固定一份列表，或者调整 Claude 的思考强度，可以在 `$DSH_HOME\settings.yaml` 里加一段 `llm-claude`：

```yaml
llm-claude:
  reasoningEffort: high          # off | high | max —— 回答前思考多久
  maxTokens: 32000               # 单次回复的最大长度（token）
  defaultContextWindow: 200000   # 下面没列到的模型用这个上下文大小兜底
  models:
    - id: claude-sonnet-5
      name: Claude Sonnet 5
      contextWindow: 1000000
      maxTokens: 32000
```

> 这份列表只是建议，不是限制 —— 只要是 Anthropic 认识的模型 id 都能用，哪怕没写在这里。

## 工作原理

给好奇的人：

- **登录**用的是 OAuth PKCE，和 Claude Code CLI 是同一套流程。插件会在本地临时监听一个端口，接住 claude.ai 授权后的跳转，然后把令牌存进 `$DSH_HOME/.credentials.yaml`。
- **对话**以流式方式发往 Anthropic Messages API，支持工具调用、extended thinking 和图片。
- **在 DSH 内部**，插件注册了一个叫 `claude-subscription` 的模型提供方，所以模型选择器和 `/model` 不用额外配置就能找到它。

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

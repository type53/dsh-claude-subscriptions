# dsh-claude-subscriptions

让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 **web 界面**直接使用你的 **Claude 订阅（Pro / Max）**：

- 在 dsh web 的 **设置 → 订阅** 标签页里，一键 OAuth 连接 claude.ai 账号（无需 API Key）；
- 连接后，对话输入框旁的 **模型选择器（/model）** 会出现 Claude 模型（Opus / Sonnet / Haiku 等），选中即可让 agent 用 Claude 执行工作；
- 备用支持直接填写 **Anthropic API Key**。

## 功能

| 能力 | 说明 |
| --- | --- |
| 设置页「订阅」标签 | `settings.section` 注册，位于 设置 → 订阅 |
| Claude 订阅 OAuth 登录 | 完整 PKCE 流程（与 Claude Code 相同），环回地址回调服务器在插件进程内运行，浏览器只需打开授权页 |
| 令牌生命周期 | access token 过期自动用 refresh token 续期；`401/403` 时自动尝试 Anthropic token-exchange 换取临时 API key 重试一次 |
| 模型接入 | 注册 `claude-subscription` provider 到 `llm` 接缝，模型目录可在 `llm-claude.models` 中自定义 |
| 思考/推理 | 支持 extended thinking（`reasoningEffort: off/high/max`），thinking 增量映射为 harness 的 reasoning 块 |
| 工具调用 | 完整 `tool_use` / `tool_result` 序列化与流式翻译 |
| API Key 备用 | 在「订阅」页或 `设置 → 模型` 中保存 `ANTHROPIC_API_KEY` |

## 安装

插件需要被挂进 dsh web profile。两种方式任选：

### 方式 A：从源码链接（适合克隆本仓库后使用）

```powershell
# 1. 克隆到本地任意目录
git clone https://github.com/<your-name>/dsh-claude-subscriptions.git
cd dsh-claude-subscriptions
pnpm install

# 2. 把插件加进 web profile（$DSH_HOME/profiles/web/package.json）：
#    - dsh.profile.bundles 追加 "dsh-claude-subscriptions"
#    - dependencies 追加 "dsh-claude-subscriptions": "link:<上面的绝对路径>"
# 3. 在 profile 目录执行 pnpm install
cd "$env:USERPROFILE\.dsh\profiles\web"
pnpm install
```

### 方式 B：发布到 npm 后用官方 CLI（推荐给最终用户）

```bash
# 插件作者发布后，使用者一条命令即可：
dsh plugin --profile web add dsh-claude-subscriptions
```

安装后**重启 dsh web 进程**（插件在启动时装载）。

## 使用

1. 打开 dsh web → **设置 → 订阅**。
2. 点 **连接 Claude 订阅** → 浏览器打开 claude.ai 授权页 → 登录并同意。
3. 回到 dsh web，卡片显示「已通过 OAuth 连接」，并显示账号。
4. 新建/继续一个会话，在输入框旁的模型选择器（或输入 `/model`）中选择 `claude-opus-4-1`、`claude-sonnet-4-5`、`claude-haiku-4-5` 等模型。

> 断开：在「订阅」页点「断开连接」，会清掉本机保存的 OAuth 令牌。

## 工作原理

- **宿主侧**（`lib/index.js`）：注册 `llm-claude` 设置命名空间与 `claude-subscription` provider 路由；`ClaudeAdapter`（`lib/adapter.js`）实现 `llm` 接缝的流式调用，请求发往 `https://api.anthropic.com/v1/messages`。
- **OAuth**（`lib/oauth.js`）：`claude-code-cli` client id + PKCE(S256)，回调落在 `http://127.0.0.1:<随机端口>/`，令牌存进凭据接缝（`CLAUDE_OAUTH_ACCESS_TOKEN` / `CLAUDE_OAUTH_REFRESH_TOKEN`，位于 `$DSH_HOME/.credentials.yaml`）。
- **握手**：浏览器在设置文档写 `llm-claude.flow`，宿主监听命名空间变化 → 生成授权 URL 写回 → 浏览器 `window.open` → 回调完成后令牌入库、`llm-claude.auth` 记录账号信息。全程只使用 settings / credentials 两个现有接缝，无自定义 RPC。
- **客户端**（`lib/client.js`）：`window.__ModuleLoader__.load` 自包含 bundle，通过 `dsh.client.platform: "web"` + `exports["./client"]` 被 dsh web 装载，注册「订阅」设置区。
- **线协议**（`lib/anthropic.js`）：harness 消息 ↔ Anthropic Messages API 序列化；Anthropic SSE（`message_start` / `content_block_*` / `message_delta` / `message_stop`）→ harness `StreamChunk`。

## 配置（`$DSH_HOME/settings.yaml` → `llm-claude:` 段）

```yaml
llm-claude:
  baseURL: https://api.anthropic.com   # 兼容端点根地址（不含 /v1）
  thinking: enabled                    # enabled | disabled
  reasoningEffort: high                # off | high | max
  maxTokens: 32000
  defaultContextWindow: 200000
  models:
    - id: claude-sonnet-4-5
      name: Claude Sonnet 4.5
      contextWindow: 200000
      maxTokens: 32000
```

## 开发

```bash
pnpm install
node scripts/smoke.mjs                        # 线协议 / 配置单测
node scripts/oauth-roundtrip-test.mjs         # OAuth 回调链路（mock 网络）
node scripts/host-boot-test.mjs               # 宿主 apply 接线
node scripts/client-boot-test.mjs             # 客户端 bundle 引导
```

## 已知边界

- 视觉输入（图片）暂不支持（适配器声明 text-only）。
- 历史 thinking 不会回传（Anthropic 的 API 不接受无签名的 thinking 输入块）。
- 订阅账号模型可用性取决于你的套餐；`llm-claude.models` 只是建议目录，端点接受任何模型 id。

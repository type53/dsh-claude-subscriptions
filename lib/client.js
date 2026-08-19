window.__ModuleLoader__.load({
	id: "dsh-claude-subscriptions",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// ── constants shared with the host half ──────────────────────────────
		const NS = "llm-claude";
		const PROVIDER = "claude-subscription";
		const AUTH_REF = "CLAUDE_SUBSCRIPTION_TOKEN";
		const API_KEY_REF = "ANTHROPIC_API_KEY";

		const zh = {
			nav: "订阅",
			title: "Claude 订阅",
			intro:
				"使用你的 Claude 订阅（Pro / Max）在对话中调用 Claude 模型。插件直接复用你本机的 Claude Code 登录状态（~/.claude/.credentials.json），或粘贴 `claude setup-token` 生成的令牌，无需弹窗登录。",
			statusTitle: "订阅状态",
			statusUsing: "当前使用",
			statusNone: "未检测到订阅凭据",
			statusPasted: "粘贴的令牌（setup-token）",
			statusClaudeCode: "Claude Code 登录",
			statusFallback: "（同时检测到 Claude Code 登录，作为备用）",
			statusAccount: "账号",
			statusPlan: "订阅类型",
			statusTier: "限流档位",
			statusExpiry: "令牌有效期",
			statusExpired: "（已过期，将自动续期）",
			statusHint:
				"优先使用粘贴的令牌，否则自动读取 Claude Code 的登录状态。订阅令牌仅供个人使用，请注意 Anthropic 服务条款；轻量个人使用通常没有问题，大量高频调用有账号风险。",
			statusRefresh: "刷新状态",
			statusRefreshed: "状态已刷新",
			modeTitle: "使用模式",
			modeToken: "令牌模式",
			modeConsole: "Claude Code 控制台",
			modeTokenDesc: "直接调用 Messages API（订阅令牌通常只放行 haiku）",
			modeConsoleDesc: "驱动本机 claude CLI 干活（保留官方客户端资格，opus/sonnet 可用）",
			modeConsoleWarn:
				"控制台模式需要本机已安装并登录 claude（PATH 中存在 claude 命令）；Claude Code 将自行执行它的工具（--dangerously-skip-permissions），harness 的工具沙箱在该模式下不介入；每次模型调用会启动一次 claude 进程（约 1-3 秒）。",
			modeChanged: "模式已切换，重启后生效（或下一次请求生效）",
			pasteTitle: "粘贴 setup-token 令牌",
			pasteHint:
				"在终端运行 `claude setup-token` 生成令牌后粘贴到此处保存。该命令由 Anthropic 官方提供，用于在 SDK/API 场景使用订阅；但受订阅条款与模型配额限制（opus/sonnet 可能无权通过 API 使用）。",
			pastePlaceholder: "粘贴 claude setup-token 输出的令牌",
			pasteSave: "保存令牌",
			pasteClear: "清除令牌",
			pasted: "已保存令牌",
			pasteRemoved: "已清除令牌",
			apiKeyTitle: "API Key 模式（备用）",
			apiKeyHint: "填写 Anthropic API Key 作为备用认证方式；订阅令牌存在时优先使用订阅。",
			apiKeyInput: "ANTHROPIC_API_KEY",
			apiKeyPlaceholder: "sk-ant-…",
			apiKeySave: "保存",
			apiKeyClear: "清除",
			apiKeyStored: "已保存",
			apiKeyRemoved: "已清除",
			modelsTitle: "可用模型",
			modelsHint:
				"连接后模型列表会自动从 Anthropic 拉取；在对话输入框左侧的模型选择器（/model）中选择 Claude 模型即可使用。",
			modelsRefresh: "刷新模型列表",
			modelsRefreshed: "模型列表已更新",
			modelsEmpty: "未获取到模型",
			readOnly: "当前部署的设置文档为只读，无法在此保存。",
			error: "出错",
			retry: "重试",
			loading: "加载中…",
		};

		const en = {
			nav: "Subscriptions",
			title: "Claude Subscription",
			intro:
				"Use your Claude subscription (Pro / Max) to call Claude models in conversations. The plugin reuses your local Claude Code login (~/.claude/.credentials.json) or a token pasted from `claude setup-token` — no popup login.",
			statusTitle: "Subscription status",
			statusUsing: "Currently using",
			statusNone: "No subscription credentials detected",
			statusPasted: "pasted token (setup-token)",
			statusClaudeCode: "Claude Code login",
			statusFallback: "(Claude Code login also detected — used as fallback)",
			statusAccount: "Account",
			statusPlan: "Plan",
			statusTier: "Rate limit tier",
			statusExpiry: "Token expires",
			statusExpired: "(expired — will auto-refresh)",
			statusHint:
				"A pasted token wins; otherwise the plugin reads your Claude Code login. Subscription tokens are for personal use — mind Anthropic's terms: light personal use is usually fine, heavy automated use carries account risk.",
			statusRefresh: "Refresh status",
			statusRefreshed: "Status refreshed",
			modeTitle: "Mode",
			modeToken: "Token mode",
			modeConsole: "Claude Code console",
			modeTokenDesc: "Call the Messages API directly (subscription tokens usually only allow haiku)",
			modeConsoleDesc: "Drive the local claude CLI (keeps the first-party entitlement — opus/sonnet work)",
			modeConsoleWarn:
				"Console mode needs `claude` installed and logged in on this machine. Claude Code executes its own tools (--dangerously-skip-permissions); the harness tool sandbox does not apply in this mode. Each model call spawns a claude process (~1-3 s).",
			modeChanged: "Mode switched — effective on the next request",
			pasteTitle: "Paste a setup-token",
			pasteHint:
				"Run `claude setup-token` in a terminal and paste the token here. The command is provided by Anthropic for using your subscription in SDK/API scenarios, but it is subject to the subscription terms and model entitlements (opus/sonnet may be rejected).",
			pastePlaceholder: "Paste the token from claude setup-token",
			pasteSave: "Save token",
			pasteClear: "Clear token",
			pasted: "Token saved",
			pasteRemoved: "Token cleared",
			apiKeyTitle: "API key mode (fallback)",
			apiKeyHint: "Store an Anthropic API key as a fallback; a subscription token takes precedence.",
			apiKeyInput: "ANTHROPIC_API_KEY",
			apiKeyPlaceholder: "sk-ant-…",
			apiKeySave: "Save",
			apiKeyClear: "Clear",
			apiKeyStored: "Saved",
			apiKeyRemoved: "Removed",
			modelsTitle: "Available models",
			modelsHint:
				"Once connected, the model list is fetched from Anthropic automatically; pick a Claude model from the model picker (/model) next to the input box.",
			modelsRefresh: "Refresh model list",
			modelsRefreshed: "Model list updated",
			modelsEmpty: "No models returned",
			readOnly: "The settings document is read-only in this deployment.",
			error: "Error",
			retry: "Retry",
			loading: "Loading…",
		};

		// ── small UI helpers (no JSX, no extra deps) ─────────────────────────
		const h = react.createElement;
		const card = (children, extra) =>
			h(
				"section",
				{
					style: Object.assign(
						{
							display: "flex",
							flexDirection: "column",
							gap: "12px",
							border: "1px solid var(--dsw-alias-border-l2)",
							borderRadius: "12px",
							padding: "14px",
						},
						extra ?? {},
					),
				},
				children,
			);
		const row = (children) =>
			h(
				"div",
				{ style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
				children,
			);
		const title = (text) =>
			h(
				"h3",
				{ style: { margin: 0, fontSize: "14px", fontWeight: 500, lineHeight: "22px", color: "var(--dsw-alias-label-primary)" } },
				text,
			);
		const text = (value, extra) =>
			h(
				"p",
				{
					style: Object.assign(
						{ margin: 0, fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" },
						extra ?? {},
					),
				},
				value,
			);
		const button = (label, onClick, opts) =>
			h(
				"button",
				{
					type: "button",
					disabled: opts?.disabled === true,
					onClick,
					style: {
						boxSizing: "border-box",
						height: "34px",
						font: "inherit",
						cursor: opts?.disabled === true ? "not-allowed" : "pointer",
						border: "none",
						borderRadius: "17px",
						padding: "0 14px",
						fontSize: "13px",
						lineHeight: "22px",
						display: "inline-flex",
						alignItems: "center",
						gap: "4px",
						background:
							opts?.variant === "secondary"
								? "var(--dsw-alias-button-secondary-fill, transparent)"
								: "var(--dsw-alias-button-primary-fill)",
						color:
							opts?.variant === "secondary"
								? "var(--dsw-alias-label-secondary)"
								: "var(--dsw-alias-label-primary-foreground)",
						...(opts?.danger === true ? { color: "var(--dsw-alias-state-error-primary)" } : {}),
						...(opts?.secondaryFill === true
							? { background: "transparent", border: "1px solid var(--dsw-alias-border-l2)" }
							: {}),
					},
				},
				label,
			);
		const input = (value, onChange, placeholder, opts) =>
			h("input", {
				type: opts?.type ?? "text",
				value,
				placeholder,
				"aria-label": placeholder,
				onChange: (event) => onChange(event.target.value),
				style: {
					boxSizing: "border-box",
					height: "34px",
					font: "inherit",
					borderRadius: "8px",
					border: "1px solid var(--dsw-alias-border-l2)",
					background: "transparent",
					color: "var(--dsw-alias-label-primary)",
					padding: "0 10px",
					fontSize: "13px",
					width: "min(360px, 100%)",
				},
			});

		// ── the settings section component ───────────────────────────────────
		function SubscriptionSection(props) {
			const { connection, ctx, t } = props;
			const api = connection.api;
			const [snap, setSnap] = react.useState(null);
			const [tokenDraft, setTokenDraft] = react.useState("");
			const [keyDraft, setKeyDraft] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);

			const messageOf = (error) => (error instanceof Error ? error.message : String(error));

			const load = react.useCallback(async () => {
				try {
					const [settingsRes, credsRes] = await Promise.all([
						api.settings.describe({}),
						api.credentials.describe({ refs: [AUTH_REF, API_KEY_REF] }),
					]);
					const nsView = settingsRes.result.ok
						? settingsRes.result.value.namespaces.find((view) => view.ns === NS)
						: undefined;
					const creds = credsRes.result.ok ? credsRes.result.value.credentials : {};
					setSnap({
						status: "ready",
						writable: settingsRes.result.ok ? settingsRes.result.value.writable : false,
						ns: nsView,
						creds,
						error: null,
					});
				} catch (error) {
					setSnap({ status: "error", writable: false, ns: undefined, creds: {}, error: messageOf(error) });
				}
			}, [api]);

			react.useEffect(() => {
				load();
			}, [load]);

			react.useEffect(() => {
				const disposers = [
					ctx.remote.$on("settings/document-updated", () => load()),
					ctx.remote.$on("credentials/updated", () => load()),
				];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, [ctx, load]);

			const mutateOnce = async (ops, revision) => {
				const res = await api.settings.mutate({
					ns: NS,
					ops,
					...(revision !== undefined ? { expectedRevision: revision } : {}),
				});
				if (!res.result.ok) throw new Error(res.result.error.message);
				return res;
			};

			const refreshStatus = async () => {
				setBusy(true);
				setNotice(null);
				try {
					// The host recomputes `llm-claude.status` from the Claude Code
					// login file and clears the marker.
					await mutateOnce([{ op: "set", path: ["refresh"], value: { at: Date.now() } }], snap?.ns?.revision);
					await load();
					setNotice(t("statusRefreshed"));
				} catch (error) {
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setBusy(false);
				}
			};

			const saveToken = async () => {
				const value = tokenDraft.trim();
				if (value.length === 0) return;
				setBusy(true);
				setNotice(null);
				try {
					await api.credentials.set({ ref: AUTH_REF, value });
					setTokenDraft("");
					await load();
					setNotice(t("pasted"));
				} catch (error) {
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setBusy(false);
				}
			};

			const clearToken = async () => {
				setBusy(true);
				setNotice(null);
				try {
					await api.credentials.unset({ ref: AUTH_REF });
					await load();
					setNotice(t("pasteRemoved"));
				} catch (error) {
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setBusy(false);
				}
			};

			const saveApiKey = async () => {
				const value = keyDraft.trim();
				if (value.length === 0) return;
				setBusy(true);
				setNotice(null);
				try {
					await api.credentials.set({ ref: API_KEY_REF, value });
					await mutateOnce([{ op: "set", path: ["apiKeyEnv"], value: API_KEY_REF }], snap?.ns?.revision);
					setKeyDraft("");
					await load();
					setNotice(t("apiKeyStored"));
				} catch (error) {
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setBusy(false);
				}
			};

			const clearApiKey = async () => {
				setBusy(true);
				setNotice(null);
				try {
					await api.credentials.unset({ ref: API_KEY_REF });
					await mutateOnce([{ op: "unset", path: ["apiKeyEnv"] }], snap?.ns?.revision);
					await load();
					setNotice(t("apiKeyRemoved"));
				} catch (error) {
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setBusy(false);
				}
			};

			const refreshModels = async () => {
				setBusy(true);
				setNotice(null);
				try {
					const res = await api.llm.discoverModels({ settingsNs: NS, provider: PROVIDER });
					if (!res.result.ok) throw new Error(res.result.error.message);
					const found = res.result.value.models;
					if (!Array.isArray(found) || found.length === 0) {
						setNotice(t("modelsEmpty"));
						return;
					}
					const next = found.map((model) => ({
						id: model.id,
						...(model.name !== undefined ? { name: model.name } : {}),
						...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
						...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
					}));
					await mutateOnce([{ op: "set", path: ["models"], value: next }], snap?.ns?.revision);
					await load();
					setNotice(t("modelsRefreshed"));
				} catch (error) {
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setBusy(false);
				}
			};

			if (snap === null || snap.status === "loading") {
				return h("section", { "aria-label": t("title") }, text(t("loading")));
			}
			if (snap.status === "error") {
				return h(
					"section",
					{ "aria-label": t("title") },
					text(`${t("error")}: ${snap.error}`),
					h("div", { style: { marginTop: "8px" } }, button(t("retry"), load)),
				);
			}

			const pastedConfigured = snap.creds[AUTH_REF]?.configured === true;
			const apiKeyConfigured = snap.creds[API_KEY_REF]?.configured === true;
			const rawStatus = snap.ns?.value?.status;
			const status =
				rawStatus != null && typeof rawStatus === "object" && Object.keys(rawStatus).length > 0 ? rawStatus : undefined;
			const models = Array.isArray(snap.ns?.value?.models) ? snap.ns.value.models : [];
			const mode = snap.ns?.value?.mode === "console" ? "console" : "token";

			const setMode = async (next) => {
				setBusy(true);
				setNotice(null);
				try {
					await mutateOnce([{ op: "set", path: ["mode"], value: next }], snap?.ns?.revision);
					await load();
					setNotice(t("modeChanged"));
				} catch (error) {
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setBusy(false);
				}
			};

			const expiryText = (at) => {
				if (typeof at !== "number" || at <= 0) return "";
				const expired = Date.now() > at;
				const when = new Date(at).toLocaleString();
				return expired ? `${when} ${t("statusExpired")}` : when;
			};

			const statusBody =
				pastedConfigured || status !== undefined
					? h(
							react.Fragment,
							null,
							row([
								statusDot(true),
								text(`${t("statusUsing")}：${pastedConfigured ? t("statusPasted") : t("statusClaudeCode")}`, {
									color: "var(--dsw-alias-label-primary)",
								}),
							]),
							pastedConfigured && status !== undefined ? row([text(t("statusFallback"))]) : null,
							status !== undefined && !pastedConfigured
								? h(
										react.Fragment,
										null,
										status.account !== undefined && status.account.length > 0
											? row([text(`${t("statusAccount")}: ${status.account}`)])
											: null,
										status.subscriptionType !== undefined && status.subscriptionType.length > 0
											? row([text(`${t("statusPlan")}: ${status.subscriptionType}`)])
											: null,
										status.rateLimitTier !== undefined && status.rateLimitTier.length > 0
											? row([text(`${t("statusTier")}: ${status.rateLimitTier}`)])
											: null,
										typeof status.expiresAt === "number" && status.expiresAt > 0
											? row([text(`${t("statusExpiry")}: ${expiryText(status.expiresAt)}`)])
											: null,
									)
								: null,
							row([
								button(t("statusRefresh"), refreshStatus, { variant: "secondary", secondaryFill: true, disabled: busy || !snap.writable }),
								pastedConfigured ? button(t("pasteClear"), clearToken, { variant: "secondary", danger: true, disabled: busy || !snap.writable }) : null,
							]),
						)
					: h(
							react.Fragment,
							null,
							row([
								statusDot(false),
								text(t("statusNone"), { color: "var(--dsw-alias-label-primary)" }),
							]),
							row([button(t("statusRefresh"), refreshStatus, { variant: "secondary", secondaryFill: true, disabled: busy || !snap.writable })]),
						);

			return h(
				"section",
				{ "aria-label": t("title") },
				h(
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: "8px", maxWidth: "720px" } },
					h(
						"h2",
						{ style: { margin: 0, fontSize: "16px", fontWeight: 500, lineHeight: "24px", color: "var(--dsw-alias-label-primary)" } },
						t("title"),
					),
					text(t("intro")),
					snap.writable === false ? text(t("readOnly"), { color: "var(--dsw-alias-state-warn-label)", fontSize: "12px" }) : null,
					notice === null ? null : text(notice, { color: "var(--dsw-alias-label-tertiary)" }),

					// ── mode selector ────────────────────────────────────────
					card([
						title(t("modeTitle")),
						row([
							button(t("modeToken"), () => setMode("token"), {
								variant: "secondary",
								secondaryFill: true,
								disabled: busy || mode === "token" || !snap.writable,
							}),
							button(t("modeConsole"), () => setMode("console"), {
								variant: "secondary",
								secondaryFill: true,
								disabled: busy || mode === "console" || !snap.writable,
							}),
							text(mode === "console" ? t("modeConsoleDesc") : t("modeTokenDesc"), {
								color: "var(--dsw-alias-label-primary)",
							}),
						]),
						mode === "console" ? text(t("modeConsoleWarn"), { color: "var(--dsw-alias-state-warn-label)", fontSize: "12px" }) : null,
					]),

					// ── subscription status card ─────────────────────────────
					card([title(t("statusTitle")), statusBody, text(t("statusHint"))]),

					// ── paste setup-token card ───────────────────────────────
					card([
						title(t("pasteTitle")),
						text(t("pasteHint")),
						pastedConfigured
							? row([
									statusDot(true),
									text(t("pasted")),
									button(t("pasteClear"), clearToken, { variant: "secondary", danger: true, disabled: busy || !snap.writable }),
								])
							: row([
									input(tokenDraft, setTokenDraft, t("pastePlaceholder"), { type: "password" }),
									button(t("pasteSave"), saveToken, { disabled: busy || tokenDraft.trim().length === 0 || !snap.writable }),
								]),
					]),

					// ── API key fallback card ──────────────────────────────────
					card([
						title(t("apiKeyTitle")),
						text(t("apiKeyHint")),
						apiKeyConfigured
							? row([
									statusDot(true),
									text(`${t("apiKeyInput")} ${t("apiKeyStored")}`),
									button(t("apiKeyClear"), clearApiKey, { variant: "secondary", disabled: busy || !snap.writable }),
								])
							: row([
									input(keyDraft, setKeyDraft, t("apiKeyPlaceholder"), { type: "password" }),
									button(t("apiKeySave"), saveApiKey, { disabled: busy || keyDraft.trim().length === 0 || !snap.writable }),
								]),
					]),

					// ── model list ─────────────────────────────────────────────
					card([
						row([
							title(t("modelsTitle")),
							button(t("modelsRefresh"), refreshModels, {
								variant: "secondary",
								secondaryFill: true,
								disabled: busy || !snap.writable,
							}),
						]),
						h(
							"ul",
							{ style: { margin: "0", padding: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" } },
							models.map((model) =>
								h(
									"li",
									{ key: String(model.id) },
									h(
										"code",
										{ style: { color: "var(--dsw-alias-label-primary)", fontSize: "12px" } },
										String(model.id),
									),
									model.name !== undefined ? text(String(model.name)) : null,
								),
							),
						),
						text(t("modelsHint")),
					]),
				),
			);
		}

		/** Small configured-status dot. */
		function statusDot(ok) {
			return h("span", {
				role: "img",
				"aria-hidden": true,
				style: {
					display: "inline-block",
					width: "8px",
					height: "8px",
					borderRadius: "50%",
					flex: "none",
					background: ok ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)",
				},
			});
		}

		// ── plugin wiring ─────────────────────────────────────────────────────
		const inject = ["slots", "locale", "connection", "remote"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-claude-subscriptions: copy dictionaries");
			const connection = ctx.get("connection");
			const t = ctx.locale.bind(NS);
			const injected = () => ({ connection, ctx, t });
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "claude-subscriptions",
						order: 30,
						label: () => t("nav"),
						inject: injected,
					},
					SubscriptionSection,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});

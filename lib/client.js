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
		const REF_ACCESS = "CLAUDE_OAUTH_ACCESS_TOKEN";
		const REF_REFRESH = "CLAUDE_OAUTH_REFRESH_TOKEN";
		const API_KEY_REF = "ANTHROPIC_API_KEY";
		const FLOW_TIMEOUT_MS = 10 * 60 * 1000;
		const POLL_MS = 1000;

		const zh = {
			nav: "订阅",
			title: "Claude 订阅",
			intro:
				"连接你的 Claude 订阅（Pro / Max）后，即可在对话中使用 Claude 的各种模型。连接走 claude.ai 的 OAuth 授权，无需 API Key；也支持直接填写 Anthropic API Key。",
			oauthTitle: "订阅连接",
			oauthConnected: "已通过 OAuth 连接 Claude 订阅",
			oauthAccount: "账号",
			oauthNotConnected: "尚未连接 Claude 订阅",
			oauthConnect: "连接 Claude 订阅",
			oauthConnecting:
				"正在等待授权…（如 Claude 页面出现邮箱验证码步骤，请按提示输入验证码，完成认证后本页会自动变为已连接）",
			oauthReconnect: "重新登录",
			oauthDisconnect: "断开连接",
			oauthCancel: "取消登录",
			oauthTimeout: "登录超时，请重试。",
			oauthOpened: "已在浏览器中打开 claude.ai 授权页",
			oauthManual: "无法自动打开授权页（可能被浏览器拦截）。",
			oauthOpenLink: "点击这里打开 Claude 授权页",
			apiKeyTitle: "API Key 模式（备用）",
			apiKeyHint: "填写 Anthropic API Key 作为备用认证方式；订阅 OAuth 已连接时优先使用订阅。",
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
			conflict: "设置已被其他窗口修改，正在重试…",
		};

		const en = {
			nav: "Subscriptions",
			title: "Claude Subscription",
			intro:
				"Connect your Claude subscription (Pro / Max) to use Claude models in conversations. Login goes through claude.ai OAuth — no API key needed. A plain Anthropic API key is also supported as a fallback.",
			oauthTitle: "Subscription",
			oauthConnected: "Connected to Claude subscription via OAuth",
			oauthAccount: "Account",
			oauthNotConnected: "Not connected to a Claude subscription",
			oauthConnect: "Connect Claude subscription",
			oauthConnecting:
				"Waiting for authorization… (if Claude asks for an email verification code, enter it and finish; this tab will switch to connected once done)",
			oauthReconnect: "Reconnect",
			oauthDisconnect: "Disconnect",
			oauthCancel: "Cancel",
			oauthTimeout: "Login timed out, please try again.",
			oauthOpened: "Opened the claude.ai authorization page",
			oauthManual: "The authorization page could not be opened automatically (likely blocked).",
			oauthOpenLink: "Open the Claude authorization page",
			apiKeyTitle: "API key mode (fallback)",
			apiKeyHint: "Store an Anthropic API key as a fallback; a connected OAuth subscription takes precedence.",
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
			conflict: "Settings changed elsewhere; retrying…",
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
			const [keyDraft, setKeyDraft] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [openedFlow, setOpenedFlow] = react.useState(null);
			const [notice, setNotice] = react.useState(null);
			const [manualUrl, setManualUrl] = react.useState(null);
			// Handle to the tab opened during the connect click; see startLogin.
			const authWindowRef = react.useRef(null);

			const messageOf = (error) => (error instanceof Error ? error.message : String(error));

			const load = react.useCallback(async () => {
				try {
					const [settingsRes, credsRes] = await Promise.all([
						api.settings.describe({}),
						api.credentials.describe({ refs: [REF_ACCESS, REF_REFRESH, API_KEY_REF] }),
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

			// Open the authorize window once the host has written `flow.url`.
			// schemastery resolves the optional `flow` object to `{}` when absent,
			// so "in flight" is judged by a non-empty flowId, not object presence.
			const flow = snap?.ns?.value?.flow;
			const flowId = flow != null && typeof flow.flowId === "string" && flow.flowId.length > 0 ? flow.flowId : undefined;
			react.useEffect(() => {
				if (flowId === undefined) return;
				if (typeof flow.url !== "string" || flow.url.length === 0) return;
				if (openedFlow === flowId) return;
				setOpenedFlow(flowId);
				const authWindow = authWindowRef.current;
				authWindowRef.current = null;
				if (authWindow !== null && !authWindow.closed) {
					authWindow.location.replace(flow.url);
					setNotice(t("oauthOpened"));
					return;
				}
				// Nothing to navigate — the pre-open was blocked outright, or the user
				// closed the tab. Surface the URL so the login stays completable.
				setManualUrl(flow.url);
				setNotice(t("oauthManual"));
			}, [flowId, flow?.url, openedFlow, t]);

			// Poll while a login is in flight; abort after the timeout.
			react.useEffect(() => {
				if (flowId === undefined) return undefined;
				const startedAt = typeof flow.startedAt === "number" ? flow.startedAt : Date.now();
				// Checked on every tick. Testing the deadline once, when the effect
				// ran, meant it could never fire: polling changes `snap`, not
				// `flowId`, so the effect never re-ran while a login was in flight.
				const timer = setInterval(() => {
					if (Date.now() - startedAt > FLOW_TIMEOUT_MS) {
						cancelLogin();
						return;
					}
					load();
				}, POLL_MS);
				return () => clearInterval(timer);
			}, [flowId, flow?.startedAt]);

			const mutateOnce = async (ops, revision) => {
				const res = await api.settings.mutate({
					ns: NS,
					ops,
					...(revision !== undefined ? { expectedRevision: revision } : {}),
				});
				if (!res.result.ok) {
					const error = new Error(res.result.error.message);
					error.code = res.result.error.code;
					throw error;
				}
				return res;
			};

			const isConflict = (error) => error?.code === "SETTINGS_CONFLICT";

			// The host writes this same namespace while a login is in flight, so a
			// guarded write losing the race is routine rather than exceptional.
			// Re-read and apply once more, unguarded.
			const mutateSection = async (ops) => {
				try {
					return await mutateOnce(ops, snap?.ns?.revision);
				} catch (error) {
					if (!isConflict(error)) throw error;
					setNotice(t("conflict"));
					await load();
					return mutateOnce(ops);
				}
			};

			const startLogin = async () => {
				setBusy(true);
				setNotice(null);
				setManualUrl(null);
				// Open the tab here, inside the click, while the user activation is
				// still live. The authorize URL only arrives later — the host mints it
				// and writes it back through settings — and a window.open from that
				// continuation carries no activation, so browsers block it as a popup.
				// `noopener` is not passed because it nulls the handle we need in order
				// to navigate; the child's back-reference is severed by hand instead.
				let authWindow = null;
				try {
					authWindow = window.open("", "_blank");
					if (authWindow !== null) authWindow.opener = null;
				} catch {
					authWindow = null;
				}
				authWindowRef.current = authWindow;
				try {
					const flowId =
						(typeof globalThis !== "undefined" && globalThis.crypto !== undefined && globalThis.crypto.randomUUID !== undefined
							? globalThis.crypto.randomUUID()
							: Math.random().toString(36).slice(2) + String(Date.now())) + "";
					await mutateSection([{ op: "set", path: ["flow"], value: { flowId, startedAt: Date.now() } }]);
					setOpenedFlow(null);
					await load();
				} catch (error) {
					if (authWindow !== null && !authWindow.closed) authWindow.close();
					authWindowRef.current = null;
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setBusy(false);
				}
			};

			const cancelLogin = async () => {
				const authWindow = authWindowRef.current;
				authWindowRef.current = null;
				if (authWindow !== null && !authWindow.closed) authWindow.close();
				setManualUrl(null);
				try {
					await mutateSection([{ op: "unset", path: ["flow"] }]);
					await load();
					setNotice(t("oauthTimeout"));
				} catch {
					// the host may already have cleared it
				}
			};

			const disconnect = async () => {
				setBusy(true);
				setNotice(null);
				try {
					await api.credentials.unset({ ref: REF_ACCESS });
					await api.credentials.unset({ ref: REF_REFRESH });
					await mutateSection([{ op: "unset", path: ["auth"] }]);
					await load();
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
					await mutateSection([{ op: "set", path: ["apiKeyEnv"], value: API_KEY_REF }]);
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
					await mutateSection([{ op: "unset", path: ["apiKeyEnv"] }]);
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
					await mutateSection([{ op: "set", path: ["models"], value: next }]);
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

			const oauthConfigured = snap.creds[REF_ACCESS]?.configured === true;
			const apiKeyConfigured = snap.creds[API_KEY_REF]?.configured === true;
			const auth = snap.ns?.value?.auth;
			const models = Array.isArray(snap.ns?.value?.models) ? snap.ns.value.models : [];
			const loginInFlight = flowId !== undefined;

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

					// ── subscription (OAuth) card ──────────────────────────────
					card([
						title(t("oauthTitle")),
						oauthConfigured
							? h(
									react.Fragment,
									null,
									row([
										statusDot(true),
										text(t("oauthConnected"), { color: "var(--dsw-alias-label-primary)" }),
									]),
									auth !== undefined && auth.account !== undefined
										? row([text(`${t("oauthAccount")}: ${auth.account}`)])
										: null,
									row([
										button(t("oauthReconnect"), startLogin, { disabled: busy || loginInFlight || !snap.writable }),
										button(t("oauthDisconnect"), disconnect, { variant: "secondary", danger: true, disabled: busy || !snap.writable }),
									]),
								)
							: loginInFlight
								? h(
										react.Fragment,
										null,
										text(t("oauthConnecting")),
										manualUrl === null
											? null
											: h(
													"a",
													{
														href: manualUrl,
														target: "_blank",
														rel: "noopener noreferrer",
														style: {
															fontSize: "13px",
															lineHeight: "20px",
															color: "var(--dsw-alias-link-primary, #4d6bfe)",
															wordBreak: "break-all",
														},
													},
													t("oauthOpenLink"),
												),
										row([
											button(t("oauthCancel"), cancelLogin, { variant: "secondary", disabled: busy }),
										]),
									)
								: h(
										react.Fragment,
										null,
										text(t("oauthNotConnected")),
										row([button(t("oauthConnect"), startLogin, { disabled: busy || !snap.writable })]),
									),
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

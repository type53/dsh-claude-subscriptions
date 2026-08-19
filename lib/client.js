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
		const API_KEY_REF = "ANTHROPIC_API_KEY";

		const zh = {
			nav: "Claude",
			title: "Claude (Anthropic)",
			intro:
				"在 DSH 中使用 Anthropic 的 Claude 模型。凭据可以是保存在这里的 API Key，也可以是你用 Anthropic CLI 登录后的账号 —— 两种方式都可以，DSH 会自动选用能用的那个。",
			billingNote:
				"两种方式都按 Anthropic 的 API 用量计费，不会走 Claude Pro / Max 订阅。",

			statusTitle: "连接状态",
			statusReady: "已就绪，当前使用：",
			statusNone: "尚未找到可用凭据。用下面任意一种方式配置即可。",
			statusChecked: "最后检查",
			statusTest: "测试连接",
			statusTesting: "正在测试…",
			statusOk: "连接正常，凭据可用。",

			sourceStoredKey: "保存在这里的 API Key",
			sourceEnvKey: "环境变量 ANTHROPIC_API_KEY",
			sourceEnvToken: "环境变量 ANTHROPIC_AUTH_TOKEN",
			sourceCliProfile: "Anthropic CLI 登录",

			apiKeyTitle: "方式一：API Key",
			apiKeyHint:
				"在 console.anthropic.com 创建一个 API Key，粘贴到这里即可。Key 保存在你本机的凭据库中。",
			apiKeyPlaceholder: "sk-ant-…",
			apiKeySave: "保存",
			apiKeyClear: "清除",
			apiKeyStored: "已保存 API Key",
			apiKeyRemoved: "已清除",

			cliTitle: "方式二：浏览器登录",
			cliHint:
				"安装 Anthropic 官方 CLI 后，在终端里运行下面这条命令，浏览器会打开登录页。登录一次即可，DSH 之后会自动使用它，不需要在这里粘贴任何东西。",
			cliDetected: "已检测到 CLI 登录，正在使用。",
			cliNotDetected: "尚未检测到 CLI 登录。运行上面的命令后，点「测试连接」。",

			modelsTitle: "可用模型",
			modelsHint: "在对话输入框旁的模型选择器（或 `/model`）中选择 Claude 模型即可使用。",
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
			nav: "Claude",
			title: "Claude (Anthropic)",
			intro:
				"Use Anthropic's Claude models in DSH. Credentials can be an API key saved here, or an account you signed into with the Anthropic CLI — either works, and DSH picks up whichever is available.",
			billingNote:
				"Both methods bill as Anthropic API usage. Neither draws on a Claude Pro or Max subscription.",

			statusTitle: "Connection",
			statusReady: "Ready, currently using:",
			statusNone: "No usable credential found yet. Set up either method below.",
			statusChecked: "Last checked",
			statusTest: "Test connection",
			statusTesting: "Testing…",
			statusOk: "Connection works; the credential is usable.",

			sourceStoredKey: "API key saved here",
			sourceEnvKey: "ANTHROPIC_API_KEY environment variable",
			sourceEnvToken: "ANTHROPIC_AUTH_TOKEN environment variable",
			sourceCliProfile: "Anthropic CLI login",

			apiKeyTitle: "Option 1: API key",
			apiKeyHint:
				"Create a key at console.anthropic.com and paste it here. It is stored in your machine's local credential store.",
			apiKeyPlaceholder: "sk-ant-…",
			apiKeySave: "Save",
			apiKeyClear: "Clear",
			apiKeyStored: "API key saved",
			apiKeyRemoved: "Removed",

			cliTitle: "Option 2: browser sign-in",
			cliHint:
				"Install Anthropic's CLI, then run the command below in a terminal. A browser opens for sign-in. You only do this once — DSH picks the login up automatically, with nothing to paste here.",
			cliDetected: "CLI login detected and in use.",
			cliNotDetected: "No CLI login detected yet. Run the command above, then select Test connection.",

			modelsTitle: "Available models",
			modelsHint: "Pick a Claude model from the model picker beside the message box, or with `/model`.",
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
		const code = (value) =>
			h(
				"pre",
				{
					style: {
						margin: 0,
						padding: "10px 12px",
						borderRadius: "8px",
						background: "var(--dsw-alias-fill-tsp-white-secondary, rgba(127,127,127,0.12))",
						color: "var(--dsw-alias-label-primary)",
						fontSize: "12px",
						lineHeight: "18px",
						overflowX: "auto",
					},
				},
				h("code", null, value),
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

		// ── the settings section component ───────────────────────────────────
		function ClaudeSection(props) {
			const { connection, ctx, t } = props;
			const api = connection.api;
			const [snap, setSnap] = react.useState(null);
			const [keyDraft, setKeyDraft] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [testing, setTesting] = react.useState(false);
			const [notice, setNotice] = react.useState(null);

			const messageOf = (error) => (error instanceof Error ? error.message : String(error));

			const load = react.useCallback(async () => {
				try {
					const [settingsRes, credsRes] = await Promise.all([
						api.settings.describe({}),
						api.credentials.describe({ refs: [API_KEY_REF] }),
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
				if (!res.result.ok) {
					const error = new Error(res.result.error.message);
					error.code = res.result.error.code;
					throw error;
				}
				return res;
			};

			const isConflict = (error) => error?.code === "SETTINGS_CONFLICT";

			// The host writes this namespace whenever it resolves a credential, so a
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

			/** Resolve a credential host-side and fetch models with it. */
			const discover = async () => {
				const res = await api.llm.discoverModels({ settingsNs: NS, provider: PROVIDER });
				if (!res.result.ok) throw new Error(res.result.error.message);
				return res.result.value.models;
			};

			const testConnection = async () => {
				setTesting(true);
				setNotice(null);
				try {
					await discover();
					await load();
					setNotice(t("statusOk"));
				} catch (error) {
					setNotice(`${t("error")}: ${messageOf(error)}`);
				} finally {
					setTesting(false);
				}
			};

			const saveApiKey = async () => {
				const value = keyDraft.trim();
				if (value.length === 0) return;
				setBusy(true);
				setNotice(null);
				try {
					await api.credentials.set({ ref: API_KEY_REF, value });
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
					const found = await discover();
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

			if (snap === null) {
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

			// schemastery materializes the optional `auth` object as `{}` when absent,
			// so gate on its inner field rather than on the object's presence.
			const auth = snap.ns?.value?.auth;
			const authSource = auth != null && typeof auth.source === "string" && auth.source.length > 0 ? auth.source : undefined;
			const apiKeyConfigured = snap.creds[API_KEY_REF]?.configured === true;
			const models = Array.isArray(snap.ns?.value?.models) ? snap.ns.value.models : [];

			// Written out longhand so every key is a literal `t("…")` call.
			const sourceLabel = (source) =>
				source === "stored-key"
					? t("sourceStoredKey")
					: source === "env-key"
						? t("sourceEnvKey")
						: source === "env-token"
							? t("sourceEnvToken")
							: source === "cli-profile"
								? t("sourceCliProfile")
								: source;

			const checkedAt =
				auth != null && typeof auth.checkedAt === "number" && auth.checkedAt > 0
					? new Date(auth.checkedAt).toLocaleString()
					: undefined;

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
					text(t("billingNote"), { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" }),
					snap.writable === false ? text(t("readOnly"), { color: "var(--dsw-alias-state-warn-label)", fontSize: "12px" }) : null,
					notice === null ? null : text(notice, { color: "var(--dsw-alias-label-tertiary)" }),

					// ── connection status ──────────────────────────────────────
					card([
						title(t("statusTitle")),
						authSource === undefined
							? row([statusDot(false), text(t("statusNone"))])
							: h(
									react.Fragment,
									null,
									row([
										statusDot(true),
										text(`${t("statusReady")} ${sourceLabel(authSource)}`, {
											color: "var(--dsw-alias-label-primary)",
										}),
									]),
									checkedAt === undefined ? null : text(`${t("statusChecked")}: ${checkedAt}`, { fontSize: "12px" }),
								),
						row([
							button(testing ? t("statusTesting") : t("statusTest"), testConnection, {
								variant: "secondary",
								secondaryFill: true,
								disabled: busy || testing,
							}),
						]),
					]),

					// ── option 1: API key ──────────────────────────────────────
					card([
						title(t("apiKeyTitle")),
						text(t("apiKeyHint")),
						apiKeyConfigured
							? row([
									statusDot(true),
									text(t("apiKeyStored")),
									button(t("apiKeyClear"), clearApiKey, { variant: "secondary", disabled: busy }),
								])
							: row([
									input(keyDraft, setKeyDraft, t("apiKeyPlaceholder"), { type: "password" }),
									button(t("apiKeySave"), saveApiKey, { disabled: busy || keyDraft.trim().length === 0 }),
								]),
					]),

					// ── option 2: CLI sign-in ──────────────────────────────────
					card([
						title(t("cliTitle")),
						text(t("cliHint")),
						code("ant auth login"),
						authSource === "cli-profile"
							? row([statusDot(true), text(t("cliDetected"))])
							: text(t("cliNotDetected"), { fontSize: "12px" }),
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
					ClaudeSection,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});

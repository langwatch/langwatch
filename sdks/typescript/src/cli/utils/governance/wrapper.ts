/**
 * exec wrapper helper for `langwatch claude` / `codex` / `cursor` /
 * `gemini`. Loads the persisted device-flow config, optionally
 * pre-checks the budget (Screen-8 box + exit 2 if exceeded),
 * computes the right env-var pair for the tool, and spawns the
 * underlying binary inheriting stdio so the user keeps their
 * familiar UX.
 *
 * On Unix we use spawn() with stdio:'inherit'; signals (Ctrl-C,
 * SIGTERM) propagate via the child process group. We do NOT use
 * execve replacement - Node's child_process never replaces the
 * current process, but this is functionally equivalent for the
 * end-user (same exit code, same terminal handling) and works on
 * Windows where execve doesn't exist.
 */

import { spawn } from "node:child_process";
import { normalizeEndpoint } from "../../../internal/endpoint";
import { lwTag } from "./brand";
import { checkBudget, renderBudgetExceeded } from "./budget";
import { getCliBootstrap } from "./cli-api";
import { createCodexIOStreamer } from "./codex-rollout-otlp";
import type { GovernanceConfig } from "./config";
import { isLoggedIn, loadConfig, saveConfig } from "./config";
import { updateLangwatchClaudePlugin } from "./claude-plugin";
import {
	copilotGatewayModelPreflight,
	copilotPrespawnWarnings,
} from "./copilot-prespawn";
import { runDeviceFlowLogin } from "./login-flow";
import {
	maybeOfferIngestionShellRcPersist,
	SHELL_FUNCTION_TOOLS,
} from "./shell-rc";
import { envForTool } from "./tool-env";
import { resolveWrapperMode } from "./wrapper-mode";
import { parseToolModeFlag, resolveWrapperPath } from "./wrapper-path-choice";
import {
	classifyIngestionSetupError,
	recoverExpiredSession,
} from "./wrapper-session-recovery";

/**
 * How often the wrapper polls codex's append-only rollout while the session
 * runs, streaming each completed turn's I/O instead of one burst on exit.
 */
const CODEX_IO_POLL_MS = 2_500;

/** Single-quote a string for safe interpolation into a `sh -c` command. */
const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * Provider families the tool needs upstream. Used by `preflightWrapper`
 * to verify the org has at least one matching provider configured -
 * otherwise the gateway can authenticate the VK but has nothing to
 * route the request to, surfacing as a confusing tool-side error.
 *
 * Multi-provider tools (cursor, opencode) match any listed family.
 */
const TOOL_PROVIDER_FAMILIES: Record<string, string[]> = {
	claude: ["anthropic"],
	codex: ["openai"],
	cursor: ["anthropic", "openai"],
	gemini: ["google", "gemini"],
	opencode: ["anthropic", "openai"],
	// copilot always speaks the OpenAI wire format to the gateway
	// (ADR-039 Decision 4), but the gateway can translate to either
	// upstream, so both families satisfy preflight. Model-level
	// servability (a Claude-family model against an openai-only org)
	// cannot be validated here — see ADR-039 open questions.
	copilot: ["openai", "anthropic"],
};

export interface PreflightResult {
	ok: boolean;
	/** Human-readable, action-oriented message rendered to stderr on failure. */
	message?: string;
	/**
	 * Set on a failure a later retry might clear on its own - the gateway data
	 * plane is momentarily unreachable. When absent/false the gateway path is
	 * structurally unusable for this account/org (no virtual key, no provider
	 * configured), so a remembered gateway choice is worth forgetting to re-offer
	 * direct OTLP next time.
	 */
	retryable?: boolean;
}

/**
 * Whether to forget a remembered gateway path choice after a failed gateway
 * preflight. True only when the user had pinned gateway AND the failure is
 * structural (no virtual key / no provider) rather than a retryable
 * gateway-down, so the next run re-prompts and can offer direct OTLP instead
 * of dead-ending on the same pinned choice every time.
 */
export function shouldForgetGatewayPin(args: {
	pinnedMode: string | undefined;
	retryable: boolean | undefined;
}): boolean {
	return args.pinnedMode === "gateway" && args.retryable !== true;
}

export interface PreflightOptions {
	fetchImpl?: typeof fetch;
	bootstrapImpl?: typeof getCliBootstrap;
	/** Per-probe timeout, ms. Default 3000. */
	timeoutMs?: number;
}

/**
 * Render the "who to talk to" footer attached to every preflight
 * failure message. Single source of truth so the admin-mailto format
 * stays consistent across the three failure shapes. Bootstrap is the
 * source of `adminEmail`; on legacy servers or unreachable control
 * planes it'll be null and we fall back to a generic line.
 */
function renderContactFooter(adminEmail: string | null | undefined): string {
	if (adminEmail) {
		return `Need help? Contact your LangWatch admin: ${adminEmail}\n`;
	}
	return `If you need help, contact your LangWatch admin.\n`;
}

/**
 * Pre-exec probe for `langwatch <tool>` wrappers. Three layered checks,
 * each gracefully degrading rather than blocking on transient hiccups:
 *
 *   1. `cfg.default_personal_vk?.secret` present - without it the
 *      wrapper would silently inject no env vars and the underlying
 *      tool would call the upstream provider directly (api.anthropic.com
 *      etc.), surfacing as the wrong error or - when there's stale
 *      env from a prior session - a confusing ConnectionRefused
 *      against a stale base URL.
 *   2. `GET <gateway_url>/healthz` reachable. Catches "data plane not
 *      running" and bad `LANGWATCH_GATEWAY_URL` overrides. Fatal: if
 *      the gateway isn't reachable the tool will spin in a retry loop
 *      and there's no recovery. We don't name a specific run command
 *      (`make`, helm chart, docker compose, `npx @langwatch/server`,
 *      etc.) because deployments vary; point the user at the admin
 *      contact instead.
 *   3. `getCliBootstrap()` providers cover the tool's family. Catches
 *      the shape where login succeeds but the org has no AI provider
 *      configured yet, so the gateway has nothing to route to. 404 /
 *      missing-providers data passes through (older self-hosted
 *      servers without the endpoint).
 *
 * Bootstrap is fetched up-front (it lives on the control plane,
 * independent of the gateway data plane) so every failure message can
 * embed the org admin's email as a real contact path. A bootstrap
 * error is non-fatal; we just lose the admin mailto and continue.
 */
export async function preflightWrapper(
	cfg: GovernanceConfig,
	tool: string,
	opts: PreflightOptions = {},
): Promise<PreflightResult> {
	const cp = normalizeEndpoint(cfg.control_plane_url);
	const bootstrap = await (opts.bootstrapImpl ?? getCliBootstrap)(cfg).catch(
		() => null,
	);
	const adminEmail = bootstrap?.adminEmail ?? null;

	if (!cfg.default_personal_vk?.secret) {
		return {
			ok: false,
			message:
				`No personal virtual key on this account.\n` +
				`Your organization needs at least one AI provider configured before\n` +
				`\`langwatch ${tool}\` can route requests.\n` +
				`If you're an admin, set one up at\n` +
				`  ${cp}/settings/model-providers\n` +
				`then run \`langwatch login --device\` to refresh your credentials.\n` +
				renderContactFooter(adminEmail),
		};
	}

	const gw = normalizeEndpoint(cfg.gateway_url);
	const f = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? 3000;
	try {
		const res = await f(`${gw}/healthz`, {
			method: "GET",
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) {
			return {
				ok: false,
				retryable: true,
				message:
					`AI Gateway at ${gw} returned HTTP ${res.status}.\n` +
					`The wrapper cannot route \`langwatch ${tool}\` requests until the\n` +
					`data plane is healthy. Check that the LangWatch gateway is running.\n` +
					renderContactFooter(adminEmail),
			};
		}
	} catch (err) {
		return {
			ok: false,
			retryable: true,
			message:
				`Cannot reach AI Gateway at ${gw}\n` +
				`  ${(err as Error).message}\n` +
				`Check that the LangWatch gateway is running, or set LANGWATCH_GATEWAY_URL\n` +
				`if you've deployed it elsewhere.\n` +
				renderContactFooter(adminEmail),
		};
	}

	// The gateway program is opt-in per tool: an org enables it for a coding
	// assistant by publishing that tool's coding-assistant tile in the AI Tools
	// catalog. Without a tile for THIS tool the org hasn't turned the gateway on
	// for it (direct OTLP ingestion stays available separately), so don't route
	// a virtual key through it. `tools` undefined => legacy server that can't
	// report the catalog; skip the gate for back-compat.
	if (Array.isArray(bootstrap?.tools)) {
		const published = bootstrap.tools.some((t) => t.slug === tool);
		if (!published) {
			return {
				ok: false,
				message:
					`The gateway isn't enabled for \`${tool}\` in your organization.\n` +
					`An admin needs to publish a ${tool} coding-assistant tile in the\n` +
					`AI Tools catalog (with the gateway path enabled):\n` +
					`  ${cp}/settings/governance/tool-catalog\n` +
					renderContactFooter(adminEmail),
			};
		}
	}

	// The gateway routes through CONFIGURED provider credentials, not the curated
	// model_provider catalog tiles (those only gate the /me one-click "mint your
	// own VK" surface). Prefer the credential-derived families; fall back to the
	// tile list only on legacy servers that don't send `gatewayProviders`.
	const need = TOOL_PROVIDER_FAMILIES[tool];
	const configured =
		bootstrap?.gatewayProviders ?? bootstrap?.providers?.map((p) => p.name);
	if (need && need.length > 0 && Array.isArray(configured)) {
		const have = new Set(configured.map((n) => n.toLowerCase()));
		const matches = need.filter((n) => have.has(n));
		if (matches.length === 0) {
			const list = need.map((n) => `\`${n}\``).join(" or ");
			return {
				ok: false,
				message:
					`No ${list} provider credential is configured for your organization.\n` +
					`\`langwatch ${tool}\` needs at least one enabled provider to route\n` +
					`requests through the gateway. If you're an admin, add one at\n` +
					`  ${cp}/settings/model-providers\n` +
					renderContactFooter(adminEmail),
			};
		}
	}

	return { ok: true };
}

/**
 * When the wrapper is invoked without a usable config, decide whether to
 * auto-trigger the device-flow login inline or to fail fast. The device
 * flow needs a TTY (the user has to copy a code or click a browser link),
 * so default ON only when stdin is a TTY. CI/scripted callers can opt in
 * explicitly via `LANGWATCH_AUTO_LOGIN=1`, or opt out via
 * `LANGWATCH_AUTO_LOGIN=0` even on an interactive shell.
 */
function shouldAutoLogin(): boolean {
	const flag = process.env.LANGWATCH_AUTO_LOGIN;
	if (flag === "1" || flag === "true") return true;
	if (flag === "0" || flag === "false") return false;
	return Boolean(process.stdin.isTTY);
}

/**
 * The env re-application prefix for the interactive-shell spawn. Runs
 * INSIDE `$SHELL -i -c` after the rc has been sourced, so the wrapper's
 * mode vars win over anything the rc exported.
 *
 * For scoped-function tools (gemini / opencode / copilot) the prefix
 * additionally `unset -f`s the tool in EVERY mode: a previously
 * persisted Path-B rc function re-applies its frozen env AT INVOCATION
 * TIME — after these exports — so leaving it in place lets stale state
 * win over this run's resolution. Concretely: on gateway runs the
 * function re-injects OTel exporter env on top of gateway capture
 * (double trace, double cost); on ingestion runs it overrides a
 * freshly-minted token with a stale one (silent 401s) and re-enables
 * content capture the user explicitly opted out of. `unset -f` removes
 * only the function FROM THIS SHELL SESSION — user aliases survive
 * (the whole reason for the interactive shell) and the rc file is
 * never touched, so bare `<tool>` runs keep capturing.
 */
export function buildShellReapply(args: {
	tool: string;
	clears: string[];
	vars: Record<string, string>;
}): string {
	const parts: string[] = [];
	if (SHELL_FUNCTION_TOOLS.includes(args.tool)) {
		parts.push(`unset -f ${args.tool} 2>/dev/null`);
	}
	parts.push(...args.clears.map((k) => `unset ${k}`));
	parts.push(
		...Object.entries(args.vars).map(
			([k, v]) => `export ${k}=${shellQuote(v)}`,
		),
	);
	return parts.join("; ");
}

/**
 * Run the named tool routed through the gateway. Inherits stdio so
 * the user gets the same interactive UX they'd have invoking the
 * tool directly. Exits the parent process with the child's exit
 * code (or 2 if the budget pre-check fired).
 */
export async function runWrapped(tool: string, args: string[]): Promise<never> {
	let cfg = loadConfig();
	if (!isLoggedIn(cfg)) {
		if (!shouldAutoLogin()) {
			process.stderr.write(
				"Not logged in. Run `langwatch login --device` first.\n",
			);
			process.exit(1);
		}
		process.stderr.write("Not logged in. Starting device-flow login...\n");
		try {
			cfg = await runDeviceFlowLogin({ cfg });
		} catch (err) {
			process.stderr.write(
				`login failed: ${(err as Error).message ?? "unknown error"}\n`,
			);
			process.exit(1);
		}
		if (!isLoggedIn(cfg)) {
			process.stderr.write("login did not complete - exiting\n");
			process.exit(1);
		}
	}

	// Budget pre-check - render Screen-8 box + exit 2 BEFORE exec.
	const exceeded = await checkBudget(cfg);
	if (exceeded) {
		process.stderr.write(renderBudgetExceeded(exceeded));
		if (exceeded.request_increase_url) {
			cfg.last_request_increase_url = exceeded.request_increase_url;
			try {
				saveConfig(cfg);
			} catch {
				// Config write failure shouldn't change the spec'd exit
				// code - the next `langwatch request-increase` falls back
				// to the static page.
			}
		}
		process.exit(2);
	}

	// Strip the wrapper-only `--tool-mode` flag from the args BEFORE anything
	// forwards them to the real tool, and resolve any explicit override.
	// Everything else stays verbatim + in order for the child invocation.
	const { args: toolArgs, override: pathOverride } = parseToolModeFlag(args);

	// Decide Path A (gateway) vs Path B (ingestion) for this run. Prompts
	// (and remembers the answer) only when the org policy allows BOTH paths,
	// stdin/stdout is a TTY, and there's no pinned preference / override.
	// Runs BEFORE env injection + spawn so the prompt owns stdin.
	let pathChoice;
	try {
		pathChoice = await resolveWrapperPath({
			cfg,
			tool,
			args: toolArgs,
			override: pathOverride,
			// Re-check the org policy at run time so a path the admin disabled
			// after login is respected without a re-login. Best-effort: on any
			// failure resolveWrapperPath keeps the login-cached policy map.
			refreshPolicies: (c) =>
				getCliBootstrap(c).then((b) => b?.toolPolicies ?? null),
		});
	} catch (err) {
		process.stderr.write(`path selection failed: ${(err as Error).message}\n`);
		process.exit(2);
	}
	if (pathChoice.isAborted) {
		process.stderr.write(`${lwTag()} cancelled, ${tool} was not started.\n`);
		process.exit(130);
	}

	const toolEnv = envForTool(cfg, tool);
	const gatewayVars = toolEnv.vars;
	const gatewayClears = toolEnv.clears ?? [];
	let modeResult;
	try {
		modeResult = await resolveWrapperMode(
			cfg,
			tool,
			gatewayVars,
			gatewayClears,
			pathChoice.mode,
		);
	} catch (err) {
		// Direct-OTLP setup can fail at mint time: an expired device session,
		// no personal workspace yet, an unreachable control plane. None of
		// those are a reason to route the tool through the gateway instead;
		// that path bills model usage to the org and the user has to opt into
		// it. An expired session is the one recoverable case, so offer the
		// login inline and retry the same path.
		if (
			pathChoice.mode === "ingestion" &&
			classifyIngestionSetupError(err) === "expired_session"
		) {
			const recovery = await recoverExpiredSession({ cfg, tool });
			if (recovery.status === "abort") {
				process.stderr.write(recovery.message);
				process.exit(recovery.exitCode);
			}
			cfg = recovery.cfg;
			// The fresh login may carry a different personal VK, so recompute
			// the gateway env from the new config rather than reusing the pair
			// derived from the expired session.
			const refreshedEnv = envForTool(cfg, tool);
			try {
				modeResult = await resolveWrapperMode(
					cfg,
					tool,
					refreshedEnv.vars,
					refreshedEnv.clears ?? [],
					"ingestion",
				);
			} catch (err2) {
				process.stderr.write(
					`${lwTag()} still could not set up direct OTLP telemetry for ` +
						`${tool}: ${(err2 as Error).message}\n`,
				);
				process.exit(2);
			}
		} else {
			process.stderr.write(
				`mode resolution failed: ${(err as Error).message}\n`,
			);
			process.exit(2);
		}
	}

	// Surface any platform-policy path change (e.g. the org admin turned
	// direct OTLP off for this tool, so the wrapper routed through the
	// gateway instead) so the member sees why the path differs.
	if (modeResult.notice) {
		process.stderr.write(`${modeResult.notice}\n`);
	}

	// Latest-login-wins feedback: name every persisted telemetry target the
	// resolver re-synced because a previous install left stale values, plus
	// any change to the claude project-level pin, so silent rerouting of
	// telemetry is never silent to the user.
	for (const label of modeResult.refreshedWiring ?? []) {
		process.stderr.write(
			`${lwTag()} refreshed ${label} to point at this login.\n`,
		);
	}
	const pin = modeResult.claudeProjectPin;
	if (pin?.action === "created") {
		process.stderr.write(
			`${lwTag()} pinned claude telemetry for this directory in ` +
				`.claude/settings.local.json (project settings outrank ` +
				`~/.claude/settings.json). \`langwatch logout\` here removes it.\n`,
		);
	} else if (pin?.action === "updated") {
		process.stderr.write(
			`${lwTag()} refreshed the claude telemetry pin in ` +
				`.claude/settings.local.json to point at this login.\n`,
		);
	} else if (pin?.action === "removed") {
		process.stderr.write(
			`${lwTag()} removed the langwatch telemetry env from ` +
				`.claude/settings.local.json (the gateway captures this session).\n`,
		);
	} else if (pin?.action === "skipped") {
		process.stderr.write(
			`${lwTag()} left the OTLP env in .claude/settings.local.json alone, ` +
				`it isn't langwatch-authored. Claude applies it on top of this ` +
				`run's env, so telemetry may go elsewhere: remove those keys or ` +
				`point them at ${modeResult.endpoint ?? "this login"}.\n`,
		);
	}

	// Copilot-only pre-spawn warnings (enterprise managed-settings OTel
	// pin + version gate). Deliberately OUTSIDE the gateway-only preflight
	// below — copilot defaults to ingestion, and both conditions make
	// capture silently incomplete on either path (ADR-039 D8/D9).
	if (tool === "copilot") {
		for (const warning of copilotPrespawnWarnings()) {
			process.stderr.write(`${warning}\n`);
		}
	}

	// Copilot BYOK (gateway) requires a model; fail fast with an actionable
	// message instead of copilot's opaque downstream error.
	if (modeResult.mode === "gateway" && tool === "copilot") {
		const modelError = copilotGatewayModelPreflight({
			args: toolArgs,
			env: process.env,
		});
		if (modelError) {
			process.stderr.write(`${lwTag()} ${modelError}\n`);
			process.exit(1);
		}
	}

	if (modeResult.mode === "gateway") {
		const probe = await preflightWrapper(cfg, tool);
		if (!probe.ok) {
			process.stderr.write(probe.message ?? "preflight failed\n");
			// A remembered gateway choice that can't actually serve this account/org
			// (no virtual key / no provider configured) would re-fail every run. Drop
			// the pin so the next run re-asks and the user can pick direct OTLP. A
			// transient gateway-down failure keeps the pin (a retry may succeed).
			if (
				shouldForgetGatewayPin({
					pinnedMode: cfg.tool_mode?.[tool],
					retryable: probe.retryable,
				})
			) {
				const toolMode = { ...cfg.tool_mode };
				delete toolMode[tool];
				cfg.tool_mode = toolMode;
				try {
					saveConfig(cfg);
					process.stderr.write(
						`${lwTag()} cleared the saved gateway path for \`${tool}\`; ` +
							`you'll be asked again next time so you can pick direct OTLP.\n`,
					);
				} catch {
					// Best-effort: a config write failure just leaves the pin in place.
				}
			}
			process.exit(2);
		}
		if (modeResult.codexConfigPath) {
			process.stderr.write(
				`${lwTag()} wired [model_providers.langwatch] in ${modeResult.codexConfigPath}.\n`,
			);
		}
		if (modeResult.codexProfilePath) {
			process.stderr.write(
				`${lwTag()} wrote profile body to ${modeResult.codexProfilePath}.\n`,
			);
		}
	} else {
		// ingestion mode side-effect feedback so the user sees what
		// the wrapper just did on their behalf.
		if (modeResult.newKeyMinted) {
			process.stderr.write(
				`${lwTag()} minted a personal ingestion key for ${tool}.\n`,
			);
		}
		if (modeResult.codexConfigPath) {
			process.stderr.write(
				`${lwTag()} wrote [otel] activation block to ${modeResult.codexConfigPath}.\n`,
			);
		}

		// Path B only: offer to persist the OTLP telemetry exports so a future
		// plain `<tool>` (without the langwatch wrapper) captures
		// automatically. Gated on ingestion mode + opt-out remembered. Runs
		// BEFORE spawn so the prompt still owns stdin.
		await maybeOfferIngestionShellRcPersist({
			cfg,
			tool,
			vars: modeResult.vars,
		});
	}

	// Keep the installed plugin current, whichever tool this run wraps. The
	// plugin is installed once per machine, not once per tool, so tying its
	// upkeep to `langwatch claude` would leave it to rot on a machine whose
	// owner mostly wraps something else. It is stamped to once a day, so nearly
	// every run reads one config field and moves on, and it runs BEFORE the
	// spawn so a new version reaches the session this launch is about to start
	// rather than the one after it. Housekeeping, so it warns and continues.
	const pluginUpdate = updateLangwatchClaudePlugin({
		// Said before the work, not after it: the check fetches from a network
		// that may be slow or half-open, and a launch that pauses without
		// explanation reads as the wrapper having hung.
		onCheckStart: () =>
			process.stderr.write(
				`${lwTag()} checking whether the LangWatch plugin for Claude Code ` +
					`is up to date (once a day).\n`,
			),
	});
	if (pluginUpdate.action === "updated") {
		process.stderr.write(
			`${lwTag()} updated the LangWatch plugin for Claude Code, ` +
				`${pluginUpdate.from} to ${pluginUpdate.to}.\n`,
		);
	} else if (pluginUpdate.action === "failed") {
		process.stderr.write(
			`${lwTag()} couldn't update the LangWatch plugin for Claude Code ` +
				`(best-effort, continuing): ${pluginUpdate.reason}\n`,
		);
	}

	// Scrub conflicting twins from the inherited parent env BEFORE merging
	// our vars in. The clears list per tool exists because legacy creds
	// exported in the user's shell (e.g. ANTHROPIC_API_KEY from direct
	// Anthropic SDK usage) would otherwise race with the gateway-routed
	// ANTHROPIC_AUTH_TOKEN we set, surfacing as the claude-code warning
	// "Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set, auth may not
	// work as expected" and, worse, occasionally letting the SDK pick the
	// wrong credential.
	const parentEnv = { ...process.env };
	for (const key of modeResult.clears ?? []) {
		delete parentEnv[key];
	}
	const env = { ...parentEnv, ...modeResult.vars };
	// Forward the user's args verbatim and in order, minus the stripped
	// wrapper flag (`--tool-mode`). Any mode-specific prepends (e.g. codex
	// `--profile langwatch-gateway`) lead.
	const finalArgs = [...(modeResult.extraArgs ?? []), ...toolArgs];

	// Resolve the tool the way the user's own shell would: route it through
	// their interactive login shell (zsh/bash) so aliases AND functions are
	// honored - e.g. `alias claude='claude --dangerously-skip-permissions'`,
	// not just the bare PATH binary. `-i` sources the rc file where aliases
	// live; the wrapper's env (mode vars + clears) is re-applied *after* that
	// so a user's rc can't clobber the gateway / OTLP wiring. Args ride
	// positional params ("$@") and are never re-quoted. `tool` is whitelisted
	// (claude/codex/copilot/cursor/gemini/opencode) so the command string is safe.
	const shellName = (process.env.SHELL ?? "").split("/").pop() ?? "";
	const aliasShell =
		process.platform !== "win32" &&
		(shellName === "zsh" || shellName === "bash")
			? process.env.SHELL!
			: null;

	const notFoundMessage = `${tool} not found in PATH - install it first (https://docs.langwatch.ai/ai-gateway/governance/admin-setup#cli-device-flow-rest-api)`;

	// Stamp the session start so the codex rollout harvest only reads rollout
	// files this run produced (codex names them by start time + mtime).
	const sessionStartMs = Date.now();

	// Codex never puts the prompt or the assistant reply on the wire (its OTLP
	// spans carry tokens + model only), but it writes the full transcript to an
	// append-only rollout file whose per-turn `task_started` records the exact
	// OTLP trace_id. Poll it WHILE codex runs and emit each turn the moment it
	// completes, so content streams in per turn instead of one multi-megabyte
	// burst on exit. The poll plus a final sweep on close are idempotent (the
	// per-turn span id is trace_id-derived), so overlap dedups server-side.
	const codexStreamer =
		tool === "codex" &&
		modeResult.mode === "ingestion" &&
		modeResult.endpoint &&
		modeResult.ingestionToken
			? createCodexIOStreamer({
					sinceMs: sessionStartMs,
					endpoint: `${normalizeEndpoint(modeResult.endpoint)}/v1/traces`,
					token: modeResult.ingestionToken,
				})
			: null;
	let codexPoll: ReturnType<typeof setInterval> | null = null;
	if (codexStreamer) {
		let inFlight = false;
		codexPoll = setInterval(() => {
			// Skip a tick if the previous harvest (file read + POST, ≤5s) is still
			// running so slow ticks can't pile up.
			if (inFlight) return;
			inFlight = true;
			void codexStreamer
				.harvest(Date.now())
				.catch(() => 0)
				.finally(() => {
					inFlight = false;
				});
		}, CODEX_IO_POLL_MS);
		// The child process drives the lifecycle; never let the poll keep the event
		// loop alive on its own.
		codexPoll.unref?.();
	}

	let child;
	if (aliasShell) {
		const reapply = buildShellReapply({
			tool,
			clears: modeResult.clears ?? [],
			vars: modeResult.vars,
		});
		// Resolve the tool inside the same login shell before handing over so a
		// missing tool surfaces our actionable message rather than a bare
		// `command not found`. `command -v` honors the aliases/functions/PATH the
		// spawn below would use. The direct-spawn branch relies on ENOENT instead.
		const guard = `command -v -- ${shellQuote(tool)} >/dev/null 2>&1 || { printf '%s\\n' ${shellQuote(notFoundMessage)} >&2; exit 127; }`;
		const command = `${reapply ? `${reapply}; ` : ""}${guard}; ${tool} "$@"`;
		child = spawn(aliasShell, ["-i", "-c", command, tool, ...finalArgs], {
			stdio: "inherit",
			env,
		});
	} else {
		// Windows (npm installs the tools as `.cmd` shims, so resolve via the
		// shell) or a shell we don't special-case (fish, etc.): spawn directly.
		child = spawn(tool, finalArgs, {
			stdio: "inherit",
			env,
			shell: process.platform === "win32",
		});
	}
	child.on("error", (err) => {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			process.stderr.write(`${notFoundMessage}\n`);
			process.exit(127);
		}
		process.stderr.write(`exec ${tool}: ${err.message}\n`);
		process.exit(1);
	});
	const exitCode = await new Promise<number>((resolve) => {
		child.on("close", (code) => resolve(code ?? 1));
	});

	// Stop polling and do one final sweep so the last turn (completed between the
	// last poll and exit) still lands. Best-effort: a coding session must never
	// fail or stall on the content harvest.
	if (codexPoll) clearInterval(codexPoll);
	if (codexStreamer) {
		try {
			await codexStreamer.harvest(Date.now());
		} catch {
			/* content recovery is non-essential; never block exit on it */
		}
	}

	process.exit(exitCode);
}

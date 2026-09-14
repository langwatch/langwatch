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
import { createSpinner } from "../spinner";
import { lwTag } from "./brand";
import { checkBudget, renderBudgetExceeded } from "./budget";
import { updateLangwatchClaudePlugin } from "./claude-plugin";
import { getCliBootstrap } from "./cli-api";
import { createCodexIOStreamer } from "./codex-rollout-otlp";
import type { GovernanceConfig } from "./config";
import { recordCliLocation } from "./cli-location";
import { isLoggedIn, loadConfig, saveConfig } from "./config";
import {
	copilotGatewayModelPreflight,
	copilotPrespawnWarnings,
} from "./copilot-prespawn";
import { runDeviceFlowLogin } from "./login-flow";
import { createPiCapture, type PiCapture } from "./pi-capture";
import { resolvePiSessionDir } from "./pi-session-dir";
import { clearToolProjectPin, pinToolToProject } from "./project-scope";
import {
	maybeOfferIngestionShellRcPersist,
	SHELL_FUNCTION_TOOLS,
} from "./shell-rc";
import { envForTool } from "./tool-env";
import { resolveWrapperMode } from "./wrapper-mode";
import {
	parseProjectScopeFlags,
	parseToolModeFlag,
	resolveWrapperPath,
} from "./wrapper-path-choice";
import {
	classifyIngestionSetupError,
	recoverExpiredSession,
} from "./wrapper-session-recovery";

/**
 * How often the wrapper polls codex's append-only rollout while the session
 * runs, streaming each completed turn's I/O instead of one burst on exit.
 */
const CODEX_IO_POLL_MS = 2_500;

/**
 * How often the wrapper re-reads pi's session file while the session runs.
 *
 * The same cadence as codex, and for the same reason: often enough that a turn
 * appears in the product while the developer is still looking at it, rarely
 * enough that a poll of a few appended lines is nothing next to the work pi is
 * doing between them.
 */
const PI_SESSION_POLL_MS = 2_500;

/**
 * How long the exit path will wait for the final capture sweep before giving
 * up on it.
 *
 * By the time the sweep runs, pi has exited and the user's shell is blocked on
 * this process for its prompt. The post inside the sweep is bounded - the
 * transport gives it five seconds - but the reader's `stat` and `read` are
 * not, and an `fs` promise against a stalled network home directory never
 * settles and cannot be cancelled once libuv holds it. Unbounded, a wedged
 * mount would hold the terminal open forever over a capture that is
 * explicitly allowed to fail.
 *
 * Ten seconds is the legitimate worst case rather than a guess: a tick's post
 * with up to five seconds left to time out, then the sweep's own post with
 * five of its own. Anything past that is not slow, it is stuck.
 */
const PI_FINAL_SWEEP_DEADLINE_MS = 10_000;

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
					`  ${cp}/governance/tool-catalog\n` +
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
 * Run one telemetry setup step behind a spinner. Setting a tool up can
 * reach the control plane (confirming the cached ingest key is live, minting
 * a fresh one after a logout), and that used to happen in silence long
 * enough to read as a hang. The spinner is stopped before the result, or the
 * error, reaches the caller, so everything printed after it lands on a clean
 * line.
 *
 * discardStdin:false for the same reason login-flow sets it: ora's default
 * flips stdin to raw mode and swallows Ctrl+C, making the wait unkillable.
 */
export async function withTelemetrySetupSpinner<T>({
	tool,
	run,
}: {
	tool: string;
	run: () => Promise<T>;
}): Promise<T> {
	const spinner = createSpinner({
		text: `Setting up telemetry for ${tool}...`,
		discardStdin: false,
	});
	spinner.start();
	try {
		return await run();
	} finally {
		spinner.stop();
	}
}

/**
 * Run the named tool routed through the gateway. Inherits stdio so
 * the user gets the same interactive UX they'd have invoking the
 * tool directly. Exits the parent process with the child's exit
 * code (or 2 if the budget pre-check fired).
 */
export async function runWrapped(tool: string, args: string[]): Promise<never> {
	// Before the config is read, so every save below carries it. The Claude
	// Code plugin's hooks run the CLI through this record when PATH cannot
	// resolve it, which is the case for a Claude Code started from a desktop
	// app.
	recordCliLocation();
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

	// Wrapper-only telemetry-scope flags, stripped before anything reaches
	// the child. `--project` pins this tool's telemetry to a team project
	// (minting a project ingest key); `--personal` clears the pin.
	const scopeFlags = parseProjectScopeFlags(args);
	if (scopeFlags.personal && scopeFlags.project) {
		process.stderr.write(
			`${lwTag()} pass either --project or --personal, not both.\n`,
		);
		process.exit(2);
	}
	if (scopeFlags.personal) {
		const cleared = clearToolProjectPin({ cfg, tool });
		process.stderr.write(
			cleared
				? `${lwTag()} cleared the project pin for ${tool}; telemetry goes to your personal workspace again.\n`
				: `${lwTag()} ${tool} has no project pin; telemetry already goes to your personal workspace.\n`,
		);
	}
	if (scopeFlags.project) {
		try {
			const pinned = await pinToolToProject({
				cfg,
				tool,
				project: scopeFlags.project,
			});
			process.stderr.write(
				`${lwTag()} pinned ${tool} telemetry to project ${pinned.label}.\n`,
			);
		} catch (err) {
			process.stderr.write(
				`${lwTag()} could not pin ${tool} to project ${scopeFlags.project}: ` +
					`${(err as Error).message}\n`,
			);
			process.exit(2);
		}
	}

	// Strip the wrapper-only `--tool-mode` flag from the args BEFORE anything
	// forwards them to the real tool, and resolve any explicit override.
	// Everything else stays verbatim + in order for the child invocation.
	const parsedMode = parseToolModeFlag(scopeFlags.args);
	const toolArgs = parsedMode.args;
	// A project pin means telemetry-only by definition, so it behaves like
	// an explicit direct-OTLP override: no gateway-vs-subscription prompt,
	// no tool_mode persistence. A literal --tool-mode flag still wins.
	const pathOverride =
		parsedMode.override ??
		(cfg.tool_project_keys?.[tool]?.secret ? "ingestion" : undefined);

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
		modeResult = await withTelemetrySetupSpinner({
			tool,
			run: () =>
				resolveWrapperMode(
					cfg,
					tool,
					gatewayVars,
					gatewayClears,
					pathChoice.mode,
				),
		});
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
				modeResult = await withTelemetrySetupSpinner({
					tool,
					run: () =>
						resolveWrapperMode(
							cfg,
							tool,
							refreshedEnv.vars,
							refreshedEnv.clears ?? [],
							"ingestion",
						),
				});
			} catch (err2) {
				process.stderr.write(
					`${lwTag()} still could not set up direct OTLP telemetry for ` +
						`${tool}: ${(err2 as Error).message}\n`,
				);
				process.exit(2);
			}
		} else {
			process.stderr.write(
				`${lwTag()} could not set up telemetry for ${tool}: ` +
					`${(err as Error).message}\n`,
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
		// Budget pre-check - render Screen-8 box + exit 2 BEFORE exec. Gateway
		// runs only: the budget gates gateway spend, and an ingestion run
		// spends nothing through us, so subscription users skip the call.
		const exceeded = await checkBudget(cfg);
		if (exceeded) {
			process.stderr.write(
				renderBudgetExceeded(exceeded, {
					fallbackUrl: `${cfg.control_plane_url}/me/budget/request`,
				}),
			);
			process.exit(2);
		}
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
		if (modeResult.projectScope) {
			process.stderr.write(
				`${lwTag()} telemetry goes to project ` +
					`${modeResult.projectScope.label ?? "(pinned ingest key)"}.\n`,
			);
		}
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
					`is up to date.\n`,
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
					logsEndpoint: `${normalizeEndpoint(modeResult.endpoint)}/v1/logs`,
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

	// pi ships no exporter at all, and its child is deliberately handed no
	// endpoint and no token (ADR-132 revision v9), so its session file is not
	// one capture path among several — it is the only one there is. Poll it
	// while pi runs, on the same shape codex uses above.
	//
	// Started with NO test on `modeResult.mode`, unlike codex. pi ignores
	// base-URL environment variables entirely (revision v10), so there is no
	// gateway run of pi that a mode gate would be protecting from
	// double-tracing: the condition would be true on every run today, and the
	// day the policy changed it would turn all capture off in silence, for
	// exactly the users holding keys. What capture actually needs is somewhere
	// to post to, so that is what is checked — and it says so rather than going
	// quiet, because pi has no second path to fall back on.
	let piCapture: PiCapture | null = null;
	let piPoll: ReturnType<typeof setInterval> | null = null;
	// The pass a tick has started, for as long as it is running. Held out here
	// rather than as a boolean inside the block because the exit sweep below has
	// to be able to WAIT for it, not merely notice it — see there for why.
	let piInFlight: Promise<unknown> | null = null;
	if (tool === "pi") {
		if (modeResult.endpoint && modeResult.ingestionToken) {
			const capture = createPiCapture({
				// Stamped before the spawn: a session file untouched since then is
				// one this run never wrote to, and belongs to nobody's launch of ours.
				sinceMs: sessionStartMs,
				sessionsDir: await resolvePiSessionDir({
					toolArgs,
					env: process.env,
				}),
				// Events, never spans: a pi turn on both lanes would be counted twice.
				logsEndpoint: `${normalizeEndpoint(modeResult.endpoint)}/v1/logs`,
				token: modeResult.ingestionToken,
			});
			piCapture = capture;
			piPoll = setInterval(() => {
				// Skip a tick while the previous pass is still running - and NOT for
				// the reason the codex block gives. A codex harvest is stateless and
				// its span ids are trace-id-derived, so overlap there merely wastes a
				// request. Two pi passes that interleave both read the same byte range
				// and both run `cursor.offset += complete.length`
				// (`pi-session-stream.ts:210`), leaving the offset a whole chunk past
				// the end of the file. Nothing is sent twice - the seen-set stops that
				// - but every append after it is skipped until the file happens to
				// shrink and the cursor resets to zero. It heals itself, silently,
				// having lost the turns in between.
				if (piInFlight) return;
				piInFlight = capture
					.harvest()
					.catch(() => 0)
					.finally(() => {
						piInFlight = null;
					});
			}, PI_SESSION_POLL_MS);
			// Same as codex: the child drives the lifecycle, so the timer must never
			// be the thing keeping the process alive.
			piPoll.unref?.();
		} else {
			process.stderr.write(
				`${lwTag()} pi session capture is off for this run: no ingestion ` +
					`endpoint or key was resolved, and pi has no other way to reach ` +
					`LangWatch. Nothing from this session will be recorded.\n`,
			);
		}
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

	// Same for pi: the turns written between the last tick and exit are the ones
	// the user just produced, so the final sweep is where a short session lands
	// in full. `harvest` resolves on a failed post rather than throwing, and the
	// try is here anyway - a coding session must never fail on capture.
	if (piPoll) clearInterval(piPoll);
	if (piCapture) {
		// Abandoning the sweep has to be said out loud. A turn the deadline
		// interrupts is already off the pending list and on the wire, so it is
		// counted as neither pending nor dropped - the loss report below is
		// blind to it and would print nothing at all. Silence there is the same
		// undercount the report exists to prevent, arriving through a different
		// door.
		let sweepTimedOut = false;
		try {
			// `clearInterval` stops future ticks; it does not stop the pass a tick
			// already started, and one may have begun up to a poll interval ago
			// with a post that has five seconds to time out. Everything below
			// this line assumes that pass is finished. The sweep shares the
			// reader's cursors with it, so two passes inside `stream.read` on the
			// same file both advance the same offset over the same bytes and
			// re-key the same rows past the seen-set - duplicate turns, on a fold
			// whose sums commute and cannot collapse them. And the report that
			// follows reads counters the running pass has not written yet, so it
			// would announce a clean exit and then `process.exit` out from under
			// the post still carrying those turns. Silence about a real loss, at
			// the exact moment the loss is the user's last turns.
			// Bounded, because everything below is owed to a shell that is
			// already waiting. See PI_FINAL_SWEEP_DEADLINE_MS. Losing the last
			// turns is bad; wedging the user's terminal to avoid losing them is
			// worse, and the report below tells the truth either way - a turn the
			// sweep never got to post is still counted as pending.
			//
			// The deadline timer is deliberately not `unref`'d. If the sweep is
			// stuck on something that does not itself hold the event loop, an
			// unreferenced timer would let node fall off the end and exit 0 on
			// its own, skipping both the report and the `process.exit(exitCode)`
			// below - handing the shell a success it did not earn.
			let sweepDeadline: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					(async () => {
						await piInFlight;
						await piCapture.harvest();
					})(),
					new Promise<void>((resolve) => {
						sweepDeadline = setTimeout(() => {
							sweepTimedOut = true;
							resolve();
						}, PI_FINAL_SWEEP_DEADLINE_MS);
					}),
				]);
			} finally {
				if (sweepDeadline) clearTimeout(sweepDeadline);
			}
		} catch {
			/* capture is non-essential; never block exit on it */
		}
		// Say what was lost. Turns held back after the final sweep are turns the
		// reader will not offer again, so silence here would be an undercount the
		// user could never account for.
		// Turns discarded on overflow count too, and separately: those were lost
		// mid-session rather than at exit, so a user reading only the pending
		// figure would think a long outage cost them one pass.
		if (sweepTimedOut) {
			process.stderr.write(
				`${lwTag()} pi session capture did not finish in ` +
					`${Math.round(PI_FINAL_SWEEP_DEADLINE_MS / 1_000)}s and was ` +
					`abandoned so this shell could exit; the last turns of this ` +
					`session may not have been recorded.\n`,
			);
		}
		// Reported independently of the line above, and both can be true: the
		// deadline says the sweep was cut short, this says what was still held
		// when it was.
		const undelivered = piCapture.pendingCount() + piCapture.droppedCount();
		if (undelivered > 0) {
			process.stderr.write(
				`${lwTag()} ${undelivered} pi turn${undelivered === 1 ? "" : "s"} ` +
					`could not be sent to LangWatch and were not recorded.\n`,
			);
		}
	}

	process.exit(exitCode);
}

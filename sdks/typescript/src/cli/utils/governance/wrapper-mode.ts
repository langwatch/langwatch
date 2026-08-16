/**
 * Wrapper mode selection - Path A (gateway) vs Path B (ingestion).
 *
 * Decides, before each `langwatch <tool>` invocation, which routing
 * shape to apply:
 *
 *   - Path A (gateway): VK present + provider configured + user
 *     hasn't opted out -> inject the base-URL swap envs from
 *     envForTool(). Gateway captures I/O server-side; no OTel
 *     emission from the child.
 *   - Path B (ingestion): no VK (Claude Max-style subscription,
 *     user explicitly opted in) -> resolve the tool's ingest credential
 *     (a project pin when one exists, else the cached or freshly minted
 *     personal `ik-lw-` key), write the [otel] activation block to
 *     ~/.codex/config.toml (codex only), return the OTel exporter env
 *     block for the child.
 *
 * The two modes are mutually exclusive per the no-double-trace
 * rule - gateway capture + OTel emission of the same call would
 * double-count both traces and cost.
 *
 * Persisted preference lives at cfg.tool_mode[tool]; an unset
 * entry resolves at runtime as "gateway if VK present else
 * ingestion" with no prompt. Future iterations can layer a
 * first-run prompt similar to shell-rc.ts on top.
 */

import * as os from "node:os";

import {
	codexTraceEndpoint,
	writeCodexGatewayBlock,
	writeCodexOtelBlock,
} from "@/cli/utils/codex-config-toml";
import { setOpencodeOpenTelemetryFlag } from "@/cli/utils/opencode-config-flag";

import { claudeProjectSettingsTarget } from "./app-settings";
import { lwTag } from "./brand";
import { GovernanceCliError, issuePersonalVirtualKey } from "./cli-api";
import type { GovernanceConfig } from "./config";
import { saveConfig } from "./config";
import { deviceLabelForThisMachine } from "./device-label";
import { warnIfGeminiOAuthSelected } from "./gemini-settings-preflight";
import { buildOtelEnvBlock, SOURCE_TYPE_BY_TOOL } from "./otel-env-block";
import { resolvePlatformToolPolicy } from "./platform-tool-policy";
import { SHELL_FUNCTION_TOOLS } from "./shell-rc";
import {
	type ClaudeProjectPinResult,
	ensureClaudeProjectTelemetryPin,
	refreshClaudeUserTelemetryEnv,
	refreshScopedShellFunctions,
	removeClaudeProjectTelemetryPin,
	resolveIngestionCredential,
} from "./telemetry-refresh";
import { envForTool } from "./tool-env";
import { clearVscodeTerminalOtelEnv } from "./vscode-settings";

export type WrapperMode = "gateway" | "ingestion";

/**
 * Copilot is the one tool where landing on the gateway changes WHO PAYS:
 * BYOK routing bills the org's provider keys while the user's Copilot
 * seat sits idle (ADR-039 Decision 3). Every mid-run fallback ONTO the
 * gateway (policy downgrade here, mint-failure fallback in wrapper.ts)
 * appends this so the shift is named, never silent. Empty for every
 * other tool — their gateway swap is billing-neutral.
 */
export function copilotSeatBypassSuffix(tool: string): string {
	if (tool !== "copilot") return "";
	return " NOTE: gateway usage bills your org's provider keys, not your Copilot seat.";
}

/**
 * Whether an env value expresses an explicit content-capture opt-out.
 * OTel booleans are parsed case-insensitively, and this repo's sibling
 * parsers also honour "0"/"no"/"off", so `FALSE`, `False`, `0`, `no`,
 * `off` must all count — otherwise a user who disabled capture is
 * silently overridden into exporting full prompt/response content
 * (privacy regression). Unset means "not opted out" (default-on).
 */
function isCaptureOptOut(raw: string | undefined): boolean {
	if (raw === undefined) return false;
	return ["false", "0", "no", "off"].includes(raw.trim().toLowerCase());
}

/**
 * Run a synchronous telemetry-wiring refresh or removal, catching any
 * error so a housekeeping failure can never crash the wrapped tool launch.
 * `refreshClaudeUserTelemetryEnv`, `ensureClaudeProjectTelemetryPin`,
 * `refreshScopedShellFunctions`, and `removeClaudeProjectTelemetryPin` all
 * do unguarded synchronous fs writes; an EACCES/EROFS (a read-only home
 * dir, a locked-down project directory, …) must not exit the whole
 * `langwatch <tool>` invocation over what is meant to be best-effort
 * telemetry housekeeping, same guarantee the login-time refresh already
 * gives (`refreshTelemetryWiringForLogin` never fails the login on this).
 * Warns to stderr and returns `fallback` on failure.
 */
function tryRefresh<T>(label: string, fn: () => T, fallback: T): T {
	try {
		return fn();
	} catch (err) {
		process.stderr.write(
			`${lwTag()} couldn't refresh ${label} (best-effort, continuing): ${(err as Error).message}\n`,
		);
		return fallback;
	}
}

export interface WrapperModeResult {
	mode: WrapperMode;
	/** Env additions to merge into the child process.env. */
	vars: Record<string, string>;
	/**
	 * Path of the codex config.toml that was created / updated. Set
	 * for both codex Path A (writes [model_providers.langwatch]) and
	 * Path B (writes [otel]).
	 */
	codexConfigPath?: string;
	/**
	 * Path of the sibling profile file
	 * (~/.codex/langwatch-gateway.config.toml). Set only on codex
	 * Path A. codex 0.134+ requires the profile body in a separate
	 * file when --profile is passed.
	 */
	codexProfilePath?: string;
	/**
	 * Extra args to prepend to the child invocation. Used for codex
	 * Path A: `--profile langwatch-gateway` forces the new provider
	 * entry without touching the user's default model_provider.
	 */
	extraArgs?: string[];
	/**
	 * Env-var names to STRIP from the inherited parent environment
	 * before merging the wrapper's vars in. Propagated from the
	 * per-tool ToolEnv.clears so the resolver can pass legacy-twin
	 * scrubs through to the spawn step (e.g. claude clears
	 * ANTHROPIC_API_KEY so claude-code 2.x doesn't warn "Both
	 * ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set, auth may not
	 * work as expected").
	 */
	clears?: string[];
	/** True when the wrapper minted a fresh ingest key (vs reused a cached one). */
	newKeyMinted?: boolean;
	/**
	 * Ingestion mode only: set when the tool is pinned to a team project
	 * (`tool_project_keys`), so the wrapper can say where telemetry goes.
	 * `label` is the project slug when known.
	 */
	projectScope?: { label?: string };
	/**
	 * Path B (ingestion) only: the OTLP base endpoint (`.../api/otel`) and the
	 * ingest key. The wrapper uses these AFTER the child exits to POST codex's
	 * recovered turn input/output (from the rollout transcript) onto codex's own
	 * trace_ids, since codex never puts content on the wire itself.
	 */
	endpoint?: string;
	ingestionToken?: string;
	/**
	 * Optional one-line notice for the wrapper to print to stderr, set when
	 * the platform policy changed the resolved path (e.g. the org admin turned
	 * direct OTLP off for this tool, so the wrapper routed through the gateway
	 * instead). The member sees why the path differs from the default.
	 */
	notice?: string;
	/**
	 * Labels of persisted telemetry targets (claude settings env, scoped
	 * shell functions) that were re-synced to this run's endpoint + key
	 * because a previous install left stale values behind (latest login
	 * wins, #6202). The wrapper surfaces one line per label.
	 */
	refreshedWiring?: string[];
	/**
	 * State of the claude project-level pin ($CWD/.claude/settings.local.json)
	 * after this resolution: written/refreshed in ingestion mode (project
	 * settings outrank user-level, so the wrapped run can't be rerouted),
	 * removed in gateway mode (gateway capture + a live exporter would
	 * double-trace). `removed` only appears on the gateway path.
	 */
	claudeProjectPin?:
		| ClaudeProjectPinResult
		| { action: "removed"; path: string };
}

/**
 * Resolve mode for a single tool invocation. Returns the env block
 * the wrapper should hand to the child process. May persist a
 * refreshed ingestion token cache to ~/.langwatch/config.json as a
 * side effect.
 *
 * Does NOT prompt the user. The path-selection UX (interactive select
 * when both paths are allowed) lives upstream in `resolveWrapperPath`,
 * which passes its decision in via `forcedMode`. When `forcedMode` is
 * omitted the resolver falls back to the legacy state-only derivation
 * (persisted tool_mode, else VK-present-implies-gateway).
 *
 * The platform policy still GATES the resolved mode here (downgrade /
 * throw) regardless of how the mode was chosen, so a forced mode the
 * org admin disabled is handled the same as before.
 */
export async function resolveWrapperMode(
	cfg: GovernanceConfig,
	tool: string,
	gatewayVars: Record<string, string>,
	gatewayClears: string[] = [],
	forcedMode?: WrapperMode,
): Promise<WrapperModeResult> {
	const persistedMode = cfg.tool_mode?.[tool];
	const hasVk = !!cfg.default_personal_vk?.secret;
	// A project pin (written by `--project` / `langwatch instrument`) means
	// this tool's telemetry goes to a team project over direct OTLP. It wins
	// over a remembered tool_mode: the pin is the later, more specific
	// choice. An explicit forcedMode (flag / prompt answer) still wins.
	const hasProjectPin = !!cfg.tool_project_keys?.[tool]?.secret;
	// Prefer the per-(org, tool) policy the CLI cached at login
	// (cfg.tool_policies, from the control plane's PlatformToolPolicyService).
	// An offline / legacy CLI with no cached map falls back to the hardcoded
	// defaults inside the resolver.
	const policy = resolvePlatformToolPolicy(tool, cfg.tool_policies);

	if (!policy.allowVk && !policy.allowOtelDirect) {
		throw new GovernanceCliError(
			403,
			"tool_disabled",
			`Tool '${tool}' is disabled in the platform policy (both gateway and direct OTLP paths off). Ask your org admin to enable allow_vk or allow_otel_direct.`,
		);
	}

	let notice: string | undefined;

	// EFFECTIVE mode rules:
	//   forcedMode set        -> use it (the path-selection UX upstream
	//                            already applied flag / pref / prompt /
	//                            single-allowed-path; we just honor it).
	//   persisted="gateway"   -> gateway (even if VK absent; preflight surfaces the gap)
	//   persisted="ingestion" -> ingestion
	//   persisted="ask" / unset:
	//     hasVk -> gateway (no surprise: VK users keep current behavior)
	//     no VK -> ingestion (auto-install Path B; closes the "$5 VPS" scenario)
	//
	// Platform policy then GATES the resolved mode (the both-disabled case
	// already threw above, so exactly one path is available when a swap is
	// needed):
	//   - mode=gateway + !allowVk          -> downgrade to ingestion
	//   - mode=ingestion + !allowOtelDirect -> route through the gateway
	//     (never minting an ingestion key the admin disabled)
	let mode: WrapperMode =
		forcedMode ??
		(hasProjectPin
			? "ingestion"
			: persistedMode === "gateway"
				? "gateway"
				: persistedMode === "ingestion"
					? "ingestion"
					: hasVk
						? "gateway"
						: "ingestion");

	// Symmetric fall-back: when the resolved mode is disabled but the
	// OTHER mode is allowed, swap into it rather than throwing. Lets
	// cursor (allowVk=true, allowOtelDirect=false) keep working via
	// gateway when no VK is yet configured (preflight surfaces the
	// missing VK separately, same as before this gate existed).
	//
	// The direct-OTLP gate sits ABOVE the ingestion-key mint below: when
	// the admin disabled direct OTLP for this tool, the wrapper never
	// reaches mintIngestionKey; it routes through the gateway (allowVk is
	// guaranteed true here, since the both-disabled case threw above).
	if (mode === "gateway" && !policy.allowVk) {
		mode = "ingestion";
		// Blame accurately: a hardcoded platform policy (no org row — e.g.
		// `code`, which is ingestion-only by design) is a product fact, not
		// an admin decision.
		notice =
			cfg.tool_policies?.[tool] !== undefined
				? `${lwTag()} gateway path is disabled for ${tool} by your org admin; using direct OTLP ingestion instead.`
				: `${lwTag()} ${tool} supports direct OTLP ingestion only; using it.`;
		// Self-heal a pinned gateway preference that can never be honored —
		// otherwise the notice prints on every run forever (the gateway-side
		// pin-forgetting in wrapper.ts only runs on runs that STAY gateway).
		if (cfg.tool_mode?.[tool] === "gateway") {
			const { [tool]: _dropped, ...rest } = cfg.tool_mode;
			try {
				saveConfig({ ...cfg, tool_mode: rest });
				cfg.tool_mode = rest;
			} catch {
				// best-effort — a persist failure just re-prints next run.
			}
		}
	}
	if (mode === "ingestion" && !policy.allowOtelDirect && !hasProjectPin) {
		mode = "gateway";
		notice = `${lwTag()} direct OTLP ingestion is disabled for ${tool} by your org admin; routing through the gateway instead.${copilotSeatBypassSuffix(tool)}`;
	}
	// A project-pinned tool never silently reroutes onto the gateway: that
	// would move telemetry (and billing) from the pinned team project to the
	// personal path. The mint guard below turns this into a clear error.

	if (mode === "gateway") {
		// Structural guard: a tool with no gateway env shape (envForTool has
		// no case for it — `code` is the current example) must fail loudly
		// here, not launch with empty vars and no capture, no explanation.
		// Probed with a placeholder VK because envForTool also returns empty
		// when no VK is stored yet, and that case is handled by the lazy
		// issue below, not by this guard.
		const probe = envForTool(
			{ ...cfg, default_personal_vk: { secret: "vk-lw-probe" } },
			tool,
		);
		if (Object.keys(probe.vars).length === 0) {
			throw new GovernanceCliError(
				501,
				"gateway_unsupported",
				`The gateway path isn't implemented for '${tool}'. Run it with --tool-mode=otlp to use direct OTLP ingestion instead.`,
			);
		}
		// Lazy personal VK: login no longer auto-issues one, so the first
		// run that actually takes the gateway path asks the control plane
		// for it here. The secret is returned exactly once and persisted;
		// later runs reuse it. Subscription-only users never reach this.
		let effectiveGatewayVars = gatewayVars;
		let effectiveGatewayClears = gatewayClears;
		if (!cfg.default_personal_vk?.secret) {
			const issued = await issuePersonalVirtualKey(cfg, {
				deviceLabel: deviceLabelForThisMachine(),
			});
			cfg.default_personal_vk = {
				id: issued.id,
				secret: issued.secret,
				prefix: issued.prefix,
			};
			try {
				saveConfig(cfg);
			} catch {
				// The in-memory key still serves this run; an unsaved config
				// means the next gateway run issues again.
			}
			const refreshed = envForTool(cfg, tool);
			effectiveGatewayVars = refreshed.vars;
			effectiveGatewayClears = refreshed.clears ?? gatewayClears;
			process.stderr.write(
				`${lwTag()} issued your personal virtual key for the gateway path.\n`,
			);
		}
		if (tool === "gemini") {
			warnIfGeminiOAuthSelected();
		}
		// The gateway captures this session server-side; a project pin left
		// behind by an earlier ingestion run would make claude ALSO emit
		// OTLP (double-trace), and if that pin predates the current login it
		// would emit to the WRONG instance. Strip it for gateway runs.
		let claudeProjectPin: { action: "removed"; path: string } | undefined;
		if (tool === "claude") {
			const cwd = process.cwd();
			const removed = tryRefresh(
				"the claude project telemetry pin",
				() => removeClaudeProjectTelemetryPin({ cwd }),
				false,
			);
			if (removed) {
				claudeProjectPin = {
					action: "removed",
					path: claudeProjectSettingsTarget(cwd).path,
				};
			}
		}
		// Codex 0.130+ defers to ChatGPT OAuth by default and ignores
		// OPENAI_API_KEY unless the active model_provider is an
		// explicit env-keyed entry. Write a langwatch provider +
		// profile to ~/.codex/config.toml and force codex into it via
		// `--profile`. Other tools (claude/gemini/cursor/opencode)
		// honour their base-URL+API-key env directly, no toml needed.
		if (tool === "codex") {
			const gw = writeCodexGatewayBlock({
				gatewayUrl: cfg.gateway_url,
				envKey: "OPENAI_API_KEY",
			});
			return {
				mode,
				vars: effectiveGatewayVars,
				clears: effectiveGatewayClears,
				codexConfigPath: gw.path,
				codexProfilePath: gw.profilePath,
				extraArgs: ["--profile", gw.profile],
				notice,
			};
		}
		return {
			mode,
			vars: effectiveGatewayVars,
			clears: effectiveGatewayClears,
			notice,
			claudeProjectPin,
		};
	}

	// INGESTION mode: ensure key + (for codex) toml.
	const sourceType = SOURCE_TYPE_BY_TOOL[tool];
	if (!sourceType) {
		// No ingestion template for this tool (cursor is the current example:
		// a GUI app whose agent panel no terminal env reaches). Say so instead
		// of routing to the gateway, which would bill model usage to the org
		// on the strength of a missing template.
		throw new GovernanceCliError(
			501,
			"otel_direct_unsupported",
			`Direct OTLP ingestion isn't supported for '${tool}' yet, so \`langwatch ${tool}\` cannot send telemetry on your own plan. Run it with --tool-mode=gateway to route through the LangWatch gateway instead.`,
		);
	}

	// Defense-in-depth: the direct-OTLP gate above already routes to the
	// gateway when allowOtelDirect is off, so this mint is unreachable in
	// that case. Guard it explicitly so a future refactor of the gate can
	// never silently mint an ingestion key the admin disabled.
	if (!policy.allowOtelDirect) {
		throw new GovernanceCliError(
			403,
			"otel_direct_disabled",
			`Direct OTLP ingestion is disabled for '${tool}' by your org admin. Ask them to enable allow_otel_direct, or run with the gateway path.`,
		);
	}

	// Resolve the ingest credential: the project pin when the tool carries
	// one (used verbatim, no server call), else the cached personal
	// `ik-lw-` key when the platform confirms it is still live, else a
	// fresh personal mint. The mint route returns the plaintext key once,
	// so it is persisted to the per-tool cache below and read back on
	// later invocations rather than re-minted.
	const { token, endpoint, minted, scope, projectLabel } =
		await resolveIngestionCredential({ cfg, tool, sourceType });

	const vars = buildOtelEnvBlock(tool, endpoint, token);

	// Copilot content-capture opt-out: the capture flag is a STANDARD OTel
	// GenAI env var, so a user (or enterprise policy) that exported it as
	// "false" expressed explicit intent — never override it (same semantics
	// as the opencode experimental-flag respect below). Dropping our "true"
	// lets the inherited "false" win in the spawn merge; the notice makes
	// the tokens-only consequence visible instead of silent (ADR-039 D5).
	if (
		(tool === "copilot" || tool === "code") &&
		isCaptureOptOut(
			process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
		)
	) {
		delete vars.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
		const optOutNotice = `${lwTag()} content capture is disabled in your environment (OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT is falsey); ${tool} traces will carry tokens only.`;
		notice = notice ? `${notice}\n${optOutNotice}` : optOutNotice;
	}

	// Latest login wins (#6202): a previous install may have persisted this
	// tool's telemetry wiring with the OLD login's endpoint + key. Claude
	// applies its settings.json env block ON TOP of the child env, and the
	// scoped shell functions shadow the binary inside the login shell the
	// wrapper spawns through, so stale persisted values would override the
	// correct env this run just computed. Re-sync them in place before the
	// spawn; codex gets the same treatment via its unconditional [otel]
	// write below.
	const refreshedWiring: string[] = [];
	let claudeProjectPin: ClaudeProjectPinResult | undefined;
	if (tool === "claude") {
		const label = tryRefresh(
			"the claude telemetry env",
			() => refreshClaudeUserTelemetryEnv({ vars }),
			null,
		);
		if (label) refreshedWiring.push(label);
		claudeProjectPin = tryRefresh(
			"the claude project telemetry pin",
			() => ensureClaudeProjectTelemetryPin({ vars, cwd: process.cwd() }),
			undefined,
		);
	} else if (SHELL_FUNCTION_TOOLS.includes(tool)) {
		// Every scoped-function tool (gemini/opencode/copilot) needs its
		// persisted rc function re-synced per run: after a key re-mint the
		// wrapped run gets the fresh token but the rc function would keep
		// serving the old one to bare `<tool>` invocations — silent 401s
		// forever (the #6202 class). Login-time refresh only fires on
		// endpoint drift, not key drift.
		refreshedWiring.push(
			...tryRefresh(
				`the ${tool} scoped shell function`,
				() => refreshScopedShellFunctions({ tool, vars }),
				[] as string[],
			),
		);
	}

	// VS Code hardening, coupled to the env INJECTION (not to the shell-rc
	// persistence consent): every `code` ingestion run injects the bearer
	// into a long-lived editor whose integrated terminals inherit it, so the
	// terminal clear must be (re)applied on every run — declining or later
	// removing the persisted function must not leave terminals inheriting
	// the token. ADR-039 §Extension #2.
	if (tool === "code") {
		const vscodePlatform = process.platform;
		if (
			vscodePlatform === "darwin" ||
			vscodePlatform === "linux" ||
			vscodePlatform === "win32"
		) {
			tryRefresh(
				"the VS Code terminal telemetry clear",
				() => {
					const written = clearVscodeTerminalOtelEnv({
						platform: vscodePlatform,
						home: os.homedir(),
						keys: Object.keys(vars),
					});
					if (written === null) {
						// The writer refuses to touch a settings.json it cannot
						// round-trip — say so loudly instead of leaking silently.
						process.stderr.write(
							`${lwTag()} could not apply the VS Code terminal telemetry clear (settings.json did not parse); integrated terminals will inherit the telemetry env until it is fixed.\n`,
						);
					}
					return written;
				},
				null,
			);
		}
	}

	let codexConfigPath: string | undefined;
	if (tool === "codex") {
		// codex's OTLP/HTTP exporter sends every signal to the configured
		// endpoint verbatim - it does NOT append `/v1/traces` the way the
		// OTel SDKs in Node/Python/Go do. Spell the trace-signal suffix
		// out here so the POST lands on the real handler. codex only
		// emits traces today (no logs/metrics), so one suffix suffices.
		//
		// The Authorization header is persisted inline: config.toml is the
		// only wiring codex reads on a plain (unwrapped) run, and it is a
		// 0600 marker-managed file, so a plain `codex` captures exactly like
		// a plain `claude` does through its settings files. `langwatch
		// logout` removes the block.
		const result = writeCodexOtelBlock(
			{
				endpoint: codexTraceEndpoint(endpoint),
				ingestionToken: token,
				environment: cfg.organization?.slug ?? "langwatch",
			},
			{ persistAuthHeader: true },
		);
		codexConfigPath = result.path;
	}

	if (tool === "opencode") {
		// opencode constructs its OTLP exporter but only EMITS spans when
		// `experimental.openTelemetry` is true in ~/.config/opencode/opencode.jsonc.
		// Without this the OTEL_EXPORTER_OTLP_* env vars we set below are
		// accepted-and-ignored - Path B silently produces nothing. Idempotent
		// merge: if the user already turned it on, no write; if they
		// explicitly set false, we don't overwrite their intent.
		setOpencodeOpenTelemetryFlag();
	}

	// Persist (when freshly minted) the ingest key so the next invocation
	// reuses the cached key instead of minting again. The tool_mode PIN is
	// written only on the legacy state-only derivation (no forcedMode):
	// when the path-selection UX upstream forced the mode, IT owns
	// persistence — the interactive prompt saves an explicit answer, and
	// silent defaults (non-TTY, prompt abort, copilot ingestion-first)
	// deliberately do NOT persist so the user is asked again next run.
	// Pinning here unconditionally turned one aborted prompt / CI run
	// into a permanent silent pin that suppressed the prompt forever.
	const next: GovernanceConfig = { ...cfg };
	if (forcedMode === undefined) {
		next.tool_mode = { ...(cfg.tool_mode ?? {}), [tool]: "ingestion" };
	}
	if (minted) {
		next.default_personal_ingest_keys = {
			...(cfg.default_personal_ingest_keys ?? {}),
			[sourceType]: { secret: token },
		};
	}
	if (forcedMode === undefined || minted) {
		try {
			saveConfig(next);
		} catch {
			// Best-effort cache - failure to persist doesn't block this run.
		}
	}

	return {
		mode,
		vars,
		clears: ingestionClears(tool),
		codexConfigPath,
		newKeyMinted: minted,
		projectScope: scope === "project" ? { label: projectLabel } : undefined,
		notice,
		endpoint,
		ingestionToken: token,
		refreshedWiring,
		claudeProjectPin,
	};
}

/**
 * Env vars to scrub from the child in ingestion (Path B) mode. Copilot's
 * BYOK provider vars — if the user hand-exported them in their shell —
 * would otherwise survive into the child and keep BYOK active, routing LLM
 * traffic OFF the Copilot seat (defeating seat-preserving ingestion) and,
 * when the inherited base URL is itself a LangWatch gateway, double-capturing
 * against the OTLP lane. Gateway mode already scrubs its conflicting twins;
 * this is the ingestion-side counterpart. Non-copilot tools have no such
 * activation var, so the set is empty.
 */
function ingestionClears(tool: string): string[] {
	if (tool === "copilot") {
		return [
			"COPILOT_PROVIDER_TYPE",
			"COPILOT_PROVIDER_BASE_URL",
			"COPILOT_PROVIDER_API_KEY",
		];
	}
	if (tool === "code") {
		// An inherited `COPILOT_OTEL_EXPORTER_TYPE=file` (the ccusage setup)
		// redirects the copilot OTel family to a local file. Whether the VS
		// Code Chat extension reads this var is unverified, so we SCRUB the
		// inherited value rather than assert one of our own — neutral if the
		// extension ignores it, protective if it doesn't.
		return ["COPILOT_OTEL_EXPORTER_TYPE"];
	}
	return [];
}

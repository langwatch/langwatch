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
 *     user explicitly opted in) -> mint (or reuse a cached) personal
 *     ingest key (sk-lw-*) for this tool, write the [otel] activation
 *     block to ~/.codex/config.toml (codex only), return the OTel
 *     exporter env block for the child.
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

import {
	codexTraceEndpoint,
	writeCodexGatewayBlock,
	writeCodexOtelBlock,
} from "@/cli/utils/codex-config-toml";
import { setOpencodeOpenTelemetryFlag } from "@/cli/utils/opencode-config-flag";

import { claudeProjectSettingsTarget } from "./app-settings";
import { lwTag } from "./brand";
import { GovernanceCliError } from "./cli-api";
import type { GovernanceConfig } from "./config";
import { saveConfig } from "./config";
import { warnIfGeminiOAuthSelected } from "./gemini-settings-preflight";
import { buildOtelEnvBlock, SOURCE_TYPE_BY_TOOL } from "./otel-env-block";
import { resolvePlatformToolPolicy } from "./platform-tool-policy";
import {
	type ClaudeProjectPinResult,
	ensureClaudeProjectTelemetryPin,
	refreshClaudeUserTelemetryEnv,
	refreshScopedShellFunctions,
	removeClaudeProjectTelemetryPin,
	resolveLiveIngestionKey,
} from "./telemetry-refresh";

export type WrapperMode = "gateway" | "ingestion";

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
		(persistedMode === "gateway"
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
		notice = `${lwTag()} gateway path is disabled for ${tool} by your org admin; using direct OTLP ingestion instead.`;
	}
	if (mode === "ingestion" && !policy.allowOtelDirect) {
		mode = "gateway";
		notice = `${lwTag()} direct OTLP ingestion is disabled for ${tool} by your org admin; routing through the gateway instead.`;
	}

	if (mode === "gateway") {
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
				vars: gatewayVars,
				clears: gatewayClears,
				codexConfigPath: gw.path,
				codexProfilePath: gw.profilePath,
				extraArgs: ["--profile", gw.profile],
				notice,
			};
		}
		return {
			mode,
			vars: gatewayVars,
			clears: gatewayClears,
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

	// Reuse a cached personal ingest key (sk-lw-*) for this source when the
	// platform confirms it is still live; otherwise mint a fresh one. The
	// mint route returns the plaintext key once, so we persist it to the
	// per-tool cache below and read it back on subsequent invocations
	// rather than re-minting. Liveness rules live in resolveLiveIngestionKey
	// (shared with the login-time wiring refresh).
	const { token, prefix, endpoint, minted } = await resolveLiveIngestionKey({
		cfg,
		sourceType,
	});

	const vars = buildOtelEnvBlock(tool, endpoint, token);

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
	} else if (tool === "gemini" || tool === "opencode") {
		refreshedWiring.push(
			...tryRefresh(
				`the ${tool} scoped shell function`,
				() => refreshScopedShellFunctions({ tool, vars }),
				[] as string[],
			),
		);
	}

	let codexConfigPath: string | undefined;
	if (tool === "codex") {
		// codex's OTLP/HTTP exporter sends every signal to the configured
		// endpoint verbatim - it does NOT append `/v1/traces` the way the
		// OTel SDKs in Node/Python/Go do. Spell the trace-signal suffix
		// out here so the POST lands on the real handler. codex only
		// emits traces today (no logs/metrics), so one suffix suffices.
		const result = writeCodexOtelBlock({
			endpoint: codexTraceEndpoint(endpoint),
			ingestionToken: token,
			environment: cfg.organization?.slug ?? "langwatch",
		});
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

	// Persist mode + (when freshly minted) the ingest key so the next
	// invocation skips re-deriving the mode and reuses the cached key
	// instead of minting again.
	const next: GovernanceConfig = {
		...cfg,
		tool_mode: { ...(cfg.tool_mode ?? {}), [tool]: "ingestion" },
	};
	if (minted) {
		next.default_personal_ingest_keys = {
			...(cfg.default_personal_ingest_keys ?? {}),
			[sourceType]: { secret: token, prefix },
		};
	}
	try {
		saveConfig(next);
	} catch {
		// Best-effort cache - failure to persist doesn't block this run.
	}

	return {
		mode,
		vars,
		codexConfigPath,
		newKeyMinted: minted,
		notice,
		endpoint,
		ingestionToken: token,
		refreshedWiring,
		claudeProjectPin,
	};
}

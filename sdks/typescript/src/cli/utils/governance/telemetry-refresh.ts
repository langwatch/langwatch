/**
 * Latest login wins (#6202).
 *
 * `langwatch <tool>` persists telemetry wiring so a plain `<tool>` keeps
 * capturing: claude's env block in `~/.claude/settings.json`, codex's
 * `[otel]` block in `~/.codex/config.toml`, scoped shell functions for
 * gemini / opencode. Those persisted blocks hard-code the endpoint and
 * the ingest key of the login that wrote them, and some of them are
 * applied ON TOP of the process environment (Claude Code layers the
 * settings.json `env` block over the child env), so after logging into
 * a DIFFERENT instance a stale block silently reroutes telemetry to the
 * previous one - the wrapper's own env can't win.
 *
 * This module enforces the rule that the LATEST login wins:
 *
 *   - On login, any langwatch-authored block that points at a different
 *     endpoint than the new login is refreshed in place to the new
 *     login's endpoint + a live ingest key
 *     (`refreshTelemetryWiringForLogin`).
 *   - On every ingestion-mode wrapper run, the tool's own persisted
 *     block is re-synced value-exactly (endpoint AND key) with what the
 *     run resolved (`refreshClaudeUserTelemetryEnv`,
 *     `refreshScopedShellFunctions`; codex re-writes its [otel] block
 *     unconditionally in wrapper-mode already).
 *   - For claude the wrapper additionally maintains a project-level pin
 *     at `$CWD/.claude/settings.local.json` - the documented settings
 *     layer that outranks user-level settings - so the wrapped run can
 *     never be rerouted by user-level config at all
 *     (`ensureClaudeProjectTelemetryPin` / gateway-mode removal via
 *     `removeClaudeProjectTelemetryPin`).
 *
 * Authorship rule: refresh and removal only ever touch wiring langwatch
 * wrote. Marker-bracketed regions (codex toml, shell rc) carry explicit
 * authorship; the claude settings env block has no markers, so on top
 * of the known key set (same detection as `langwatch logout`) the
 * refresh requires the persisted values to look langwatch-shaped - a
 * `Bearer ik-lw-*` / `Bearer sk-lw-*` header or a `/api/otel` endpoint
 * (`otelWiringLooksLangwatchAuthored`). A user's own OTLP wiring (e.g.
 * a third-party collector) never matches and is never modified.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
	codexHasGatewayBlock,
	codexHasOtelBlock,
	codexOtelBlockEndpoint,
	codexTraceEndpoint,
	defaultCodexConfigPath,
	displayCodexConfigPath,
	writeCodexGatewayBlock,
	writeCodexOtelBlock,
} from "../codex-config-toml";
import {
	appEnvHasAllVars,
	appEnvHasAnyVar,
	appEnvValues,
	appSettingsTargetFor,
	claudeProjectSettingsTarget,
	installAppEnv,
	removeAppEnvVars,
} from "./app-settings";
import { installClaudeSessionContextHooks } from "./claude-hooks";
import {
	extractLookupIdFromToken,
	listIngestionKeys,
	mintIngestionKey,
} from "./cli-api";
import type { GovernanceConfig } from "./config";
import {
	buildOtelEnvBlock,
	SOURCE_TYPE_BY_TOOL,
	telemetryEnvVarNames,
} from "./otel-env-block";
import { resolvePlatformToolPolicy } from "./platform-tool-policy";
import {
	buildScopedToolFunction,
	type DetectedShell,
	persistBlockToRc,
	rcHasLangwatchBlock,
	rcPath,
	tildify,
	toolMarkers,
} from "./shell-rc";

/** All rc files a scoped shell function may have been persisted to. */
const REFRESH_SHELLS: DetectedShell[] = ["zsh", "bash", "fish"];

const LANGWATCH_BEARER_RE = /Bearer\s+(?:ik-lw-|sk-lw-)/;
const LANGWATCH_OTLP_ENDPOINT_RE = /\/api\/otel\/?$/;

/** The OTLP ingestion base endpoint a control plane serves. */
export function otlpEndpointFor(controlPlaneUrl: string): string {
	return `${controlPlaneUrl.replace(/\/+$/, "")}/api/otel`;
}

/**
 * Whether an unmarked env map (claude settings `env` block) carries
 * langwatch-shaped OTLP wiring, i.e. wiring this CLI could have
 * written: a langwatch ingest-key bearer (`ik-lw-*` / `sk-lw-*`) or a
 * `/api/otel` endpoint. An env with NEITHER identity-bearing key
 * present is refreshable (nothing to misattribute); an env whose
 * endpoint/headers point at some other system is not ours and must
 * never be modified.
 */
export function otelWiringLooksLangwatchAuthored(
	env: Record<string, string>,
): boolean {
	const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
	const headers = env.OTEL_EXPORTER_OTLP_HEADERS;
	if (!endpoint && !headers) return true;
	if (headers && LANGWATCH_BEARER_RE.test(headers)) return true;
	if (endpoint && LANGWATCH_OTLP_ENDPOINT_RE.test(endpoint)) return true;
	return false;
}

export interface IngestionKeyResolution {
	token: string;
	prefix?: string;
	/** OTLP base endpoint (`<control-plane>/api/otel`). */
	endpoint: string;
	/** True when a fresh key was minted (vs a cached one reused). */
	minted: boolean;
}

/**
 * Resolve a live personal ingest key for `sourceType`: reuse the cached
 * key when the platform confirms it is still live, otherwise mint a
 * fresh one.
 *
 * Stale-cache check (#4755): before reusing a cached key, confirm it is
 * still live on the platform. Token format: `ik-lw-{16-char lookupId}_{secret}`.
 * If the server resolves and the lookupId is absent → the key was revoked
 * (hard-cut rotation also invalidates the cache) → mint fresh. If the
 * request rejects (offline / older server without this endpoint) →
 * offline-first fallback: reuse the cache so air-gapped / degraded
 * environments still work, UNLESS the caller opted out via
 * `allowOfflineFallback: false` (see the parameter doc below).
 *
 * Pure resolution - callers persist the minted key to the config cache
 * themselves.
 */
export async function resolveLiveIngestionKey({
	cfg,
	sourceType,
	allowOfflineFallback = true,
}: {
	cfg: GovernanceConfig;
	sourceType: string;
	/**
	 * Whether a `listIngestionKeys()` failure falls back to reusing the
	 * cached secret. Defaults to true: the per-run wrapper path wants a
	 * disconnected device to keep working against the instance it already
	 * has a key for (the #4755 offline-first behavior).
	 *
	 * The login-time wiring refresh (`refreshTelemetryWiringForLogin`) sets
	 * this to false. It only reaches this resolver because the persisted
	 * wiring's endpoint already differs from the login that just
	 * completed, so the cached secret is presumptively bound to a
	 * DIFFERENT instance. Falling back to it on a network hiccup would
	 * pair the NEW endpoint with a token that was never valid there,
	 * corrupting working wiring instead of leaving it alone - minting
	 * fresh is the only outcome that can't reintroduce the #6202 hijack.
	 */
	allowOfflineFallback?: boolean;
}): Promise<IngestionKeyResolution> {
	const cached = cfg.default_personal_ingest_keys?.[sourceType];
	if (cached?.secret) {
		const cachedLookupId = extractLookupIdFromToken(cached.secret);
		let cacheIsLive = true; // assume live; falsified when server confirms otherwise
		try {
			const liveKeys = await listIngestionKeys(cfg);
			// Server resolved - verify the cached lookupId is still present
			// for this sourceType.
			const liveEntry = liveKeys.find(
				(k) => k.sourceType === sourceType && k.lookupId === cachedLookupId,
			);
			if (!liveEntry) {
				// Key was revoked or rotated on the platform - treat as no cache.
				cacheIsLive = false;
			}
		} catch {
			// Network error / older server without the endpoint: reuse cache
			// as-is (offline-first fallback - hard-cut rotation is a
			// re-mint-kills-old invariant, so a genuinely revoked key will
			// self-correct next time the device is online) - unless the
			// caller disabled that fallback.
			cacheIsLive = allowOfflineFallback;
		}
		if (cacheIsLive) {
			return {
				token: cached.secret,
				prefix: cached.prefix,
				endpoint: otlpEndpointFor(cfg.control_plane_url),
				minted: false,
			};
		}
	}
	const r = await mintIngestionKey(cfg, sourceType);
	return {
		token: r.token,
		prefix: r.prefix,
		endpoint: r.endpoint,
		minted: true,
	};
}

/**
 * Re-sync the langwatch-authored env block in `~/.claude/settings.json`
 * with the current run's values. Only fires when a langwatch-shaped
 * block is already present (presence = the user opted into persistence
 * on some earlier run) and its values differ. Returns the refreshed
 * target's label, or null when nothing was touched.
 *
 * A refresh also re-asserts the session context hooks in the same file:
 * they are part of the wiring the persisted block stands for, and a login
 * against a different instance is exactly when they can be missing.
 */
export function refreshClaudeUserTelemetryEnv({
	vars,
}: {
	vars: Record<string, string>;
}): string | null {
	const target = appSettingsTargetFor("claude");
	if (!target) return null;
	if (!appEnvHasAnyVar(target, Object.keys(vars))) return null;
	const current = appEnvValues(target);
	if (!otelWiringLooksLangwatchAuthored(current)) return null;
	if (appEnvHasAllVars(target, vars)) return null;
	installAppEnv(target, vars);
	try {
		installClaudeSessionContextHooks();
	} catch {
		// The env is the refresh that matters; the hooks are best-effort.
	}
	return `claude telemetry env (${target.displayPath})`;
}

/**
 * Re-sync the scoped `<tool>()` shell functions (gemini / opencode)
 * across every supported rc file with the current run's values. A
 * marker pair is explicit langwatch authorship, so any present block
 * whose body doesn't carry the current endpoint + Authorization header
 * is rewritten in place. Returns one label per rc file refreshed.
 */
export function refreshScopedShellFunctions({
	tool,
	vars,
}: {
	tool: string;
	vars: Record<string, string>;
}): string[] {
	const labels: string[] = [];
	const markers = toolMarkers(tool);
	const requiredKeys = [
		vars.OTEL_EXPORTER_OTLP_ENDPOINT,
		vars.OTEL_EXPORTER_OTLP_HEADERS,
	].filter((v): v is string => Boolean(v));
	for (const shell of REFRESH_SHELLS) {
		if (!rcHasLangwatchBlock({ shell, markers })) continue;
		if (rcHasLangwatchBlock({ shell, markers, requiredKeys })) continue;
		persistBlockToRc(
			shell,
			buildScopedToolFunction(tool, vars, shell),
			markers,
		);
		labels.push(`${tool} shell function (${tildify(rcPath(shell))})`);
	}
	return labels;
}

/**
 * Re-sync the langwatch `[otel]` marker block in the codex config.toml
 * with the given endpoint + token, preserving whether the Authorization
 * header was persisted. Only fires when the block is already present.
 * Returns the refreshed target's label, or null when nothing changed.
 */
export function refreshCodexOtelBlockTo({
	endpoint,
	token,
	environment,
}: {
	endpoint: string;
	token: string;
	environment: string;
}): string | null {
	if (!codexHasOtelBlock(defaultCodexConfigPath())) return null;
	const result = writeCodexOtelBlock({
		endpoint: codexTraceEndpoint(endpoint),
		ingestionToken: token,
		environment,
	});
	if (result.action === "unchanged") return null;
	return `codex [otel] block (${displayCodexConfigPath()})`;
}

export type ClaudeProjectPinAction =
	| "created"
	| "updated"
	| "unchanged"
	| "skipped";

export interface ClaudeProjectPinResult {
	action: ClaudeProjectPinAction;
	path: string;
	displayPath: string;
}

/**
 * Write (or re-sync) the langwatch telemetry env into the working
 * directory's `.claude/settings.local.json`. Claude Code applies local
 * project settings ABOVE user-level `~/.claude/settings.json`, so this
 * pin guarantees a wrapped run emits to the login that spawned it even
 * when user-level config carries wiring we may not touch. `skipped`
 * means the project file already carries OTLP wiring that is not
 * langwatch-shaped - explicit project config the user owns wins.
 *
 * On first creation the file is also added to the repo's
 * `.git/info/exclude` (best-effort): it carries a write-only ingest key
 * and must not get committed.
 */
export function ensureClaudeProjectTelemetryPin({
	vars,
	cwd,
}: {
	vars: Record<string, string>;
	cwd: string;
}): ClaudeProjectPinResult {
	const target = claudeProjectSettingsTarget(cwd);
	const base = { path: target.path, displayPath: target.displayPath };
	if (appEnvHasAllVars(target, vars)) return { action: "unchanged", ...base };
	const current = appEnvValues(target);
	const hasOwnedKey = Object.keys(vars).some((k) => k in current);
	if (hasOwnedKey && !otelWiringLooksLangwatchAuthored(current)) {
		return { action: "skipped", ...base };
	}
	const existedBefore = fs.existsSync(target.path);
	installAppEnv(target, vars);
	if (!existedBefore) excludeClaudeLocalSettingsFromGit(cwd);
	return { action: existedBefore ? "updated" : "created", ...base };
}

/**
 * Strip the langwatch telemetry env from the working directory's
 * `.claude/settings.local.json`, when present and langwatch-shaped.
 * Used by gateway-mode wrapper runs (gateway capture + a live OTel
 * exporter would double-trace) and by `langwatch logout` for the
 * current directory. Deletes the file (and an empty `.claude` dir)
 * when stripping leaves it empty. Returns true when something was
 * removed.
 */
export function removeClaudeProjectTelemetryPin({
	cwd,
}: {
	cwd: string;
}): boolean {
	const target = claudeProjectSettingsTarget(cwd);
	const keys = telemetryEnvVarNames("claude");
	if (!appEnvHasAnyVar(target, keys)) return false;
	if (!otelWiringLooksLangwatchAuthored(appEnvValues(target))) return false;
	const changed = removeAppEnvVars(target, keys);
	if (changed) removeSettingsFileIfEmpty(target.path);
	return changed;
}

function removeSettingsFileIfEmpty(filePath: string): void {
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
		const isEmptyObject =
			parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			Object.keys(parsed).length === 0;
		if (!isEmptyObject) return;
		fs.unlinkSync(filePath);
		fs.rmdirSync(path.dirname(filePath)); // only succeeds when .claude is empty
	} catch {
		// A leftover `{}` file or a non-empty .claude dir is harmless.
	}
}

/**
 * Best-effort: keep the pin (which carries an ingest key) out of the
 * repo's history via `.git/info/exclude` - local-only, never committed,
 * and the same mechanism Claude Code uses for this file. Resolves the
 * common git dir so worktrees share the exclusion. Silently does
 * nothing outside a git repo or without git on PATH.
 */
function excludeClaudeLocalSettingsFromGit(cwd: string): void {
	try {
		const probe = spawnSync("git", ["rev-parse", "--git-common-dir"], {
			cwd,
			encoding: "utf8",
			timeout: 2000,
		});
		if (probe.status !== 0 || typeof probe.stdout !== "string") return;
		const gitCommonDir = path.resolve(cwd, probe.stdout.trim());
		const excludePath = path.join(gitCommonDir, "info", "exclude");
		const line = "**/.claude/settings.local.json";
		let existing = "";
		try {
			existing = fs.readFileSync(excludePath, "utf8");
		} catch {
			// ENOENT - created below.
		}
		if (existing.split("\n").some((l) => l.trim() === line)) return;
		fs.mkdirSync(path.dirname(excludePath), { recursive: true });
		const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
		fs.writeFileSync(excludePath, `${existing}${sep}${line}\n`);
	} catch {
		// The pin still works untracked; excluding it is a courtesy.
	}
}

function claudeUserWiringNeedsRefresh(expectedEndpoint: string): boolean {
	const target = appSettingsTargetFor("claude");
	if (!target) return false;
	if (!appEnvHasAnyVar(target, telemetryEnvVarNames("claude"))) return false;
	const current = appEnvValues(target);
	if (!otelWiringLooksLangwatchAuthored(current)) return false;
	return current.OTEL_EXPORTER_OTLP_ENDPOINT !== expectedEndpoint;
}

function codexOtelWiringNeedsRefresh(expectedEndpoint: string): boolean {
	const configPath = defaultCodexConfigPath();
	if (!codexHasOtelBlock(configPath)) return false;
	return (
		codexOtelBlockEndpoint(configPath) !== codexTraceEndpoint(expectedEndpoint)
	);
}

function scopedShellFunctionNeedsRefresh(
	tool: string,
	expectedEndpoint: string,
): boolean {
	const markers = toolMarkers(tool);
	return REFRESH_SHELLS.some(
		(shell) =>
			rcHasLangwatchBlock({ shell, markers }) &&
			!rcHasLangwatchBlock({
				shell,
				markers,
				requiredKeys: [expectedEndpoint],
			}),
	);
}

function toolWiringNeedsLoginRefresh(
	tool: string,
	expectedEndpoint: string,
): boolean {
	if (tool === "claude") return claudeUserWiringNeedsRefresh(expectedEndpoint);
	if (tool === "codex") return codexOtelWiringNeedsRefresh(expectedEndpoint);
	return scopedShellFunctionNeedsRefresh(tool, expectedEndpoint);
}

export interface LoginTelemetryRefreshResult {
	/** One human-readable label per persisted target that was refreshed. */
	labels: string[];
	/**
	 * True when a fresh ingest key was minted (and stored on
	 * cfg.default_personal_ingest_keys) - the caller should saveConfig.
	 */
	mintedAny: boolean;
}

/**
 * Login-time half of latest-login-wins: walk every tool's persisted
 * wiring and refresh any langwatch-authored block whose ENDPOINT
 * differs from the login's control plane, minting (or reusing) a live
 * ingest key on the new instance for each. A block already pointing at
 * this instance is left alone here - key-level drift is re-synced
 * value-exactly by the next wrapper run, which resolves a key anyway.
 *
 * Wholly best-effort: per-tool failures (no personal workspace yet,
 * network) skip that tool; the login itself never fails on refresh.
 * Mutates `cfg.default_personal_ingest_keys` for minted keys; the
 * caller persists.
 */
export async function refreshTelemetryWiringForLogin(
	cfg: GovernanceConfig,
): Promise<LoginTelemetryRefreshResult> {
	const labels: string[] = [];
	let mintedAny = false;
	const expectedEndpoint = otlpEndpointFor(cfg.control_plane_url);

	for (const [tool, sourceType] of Object.entries(SOURCE_TYPE_BY_TOOL)) {
		try {
			if (!toolWiringNeedsLoginRefresh(tool, expectedEndpoint)) continue;
			if (!resolvePlatformToolPolicy(tool, cfg.tool_policies).allowOtelDirect) {
				// The new org forbids direct OTLP for this tool; the wrapper
				// surfaces that on the next run rather than login guessing.
				continue;
			}
			// allowOfflineFallback: false - see resolveLiveIngestionKey's doc.
			// This caller only gets here because the persisted endpoint
			// already differs from the new login, so a network hiccup must
			// mint fresh rather than reuse a secret bound to the old instance.
			const key = await resolveLiveIngestionKey({
				cfg,
				sourceType,
				allowOfflineFallback: false,
			});
			if (key.minted) {
				cfg.default_personal_ingest_keys = {
					...(cfg.default_personal_ingest_keys ?? {}),
					[sourceType]: { secret: key.token, prefix: key.prefix },
				};
				mintedAny = true;
			}
			const vars = buildOtelEnvBlock(tool, key.endpoint, key.token);
			if (tool === "claude") {
				const label = refreshClaudeUserTelemetryEnv({ vars });
				if (label) labels.push(label);
			} else if (tool === "codex") {
				const label = refreshCodexOtelBlockTo({
					endpoint: key.endpoint,
					token: key.token,
					environment: cfg.organization?.slug ?? "langwatch",
				});
				if (label) labels.push(label);
			} else {
				labels.push(...refreshScopedShellFunctions({ tool, vars }));
			}
		} catch {
			// Best-effort per tool: one failed mint must not block the login
			// or the other tools' refreshes.
		}
	}

	// Path A: the codex gateway provider block pins the gateway URL of
	// the login that wrote it. Re-sync it with this login's gateway URL
	// when present - no ingest key involved.
	try {
		if (codexHasGatewayBlock(defaultCodexConfigPath())) {
			const result = writeCodexGatewayBlock({ gatewayUrl: cfg.gateway_url });
			if (result.action !== "unchanged") {
				labels.push(`codex gateway block (${displayCodexConfigPath()})`);
			}
		}
	} catch {
		// Best-effort, same as above.
	}

	return { labels, mintedAny };
}

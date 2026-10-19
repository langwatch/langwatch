/**
 * Latest login wins (#6202): persisted telemetry wiring hard-codes the prior
 * login's endpoint and key, so a stale block can silently reroute telemetry
 * after switching logins. This module refreshes only wiring langwatch authored.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeEndpoint } from "../../../internal/endpoint";
import {
  codexGatewayBlockBaseUrl,
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
import { readClaudePluginState } from "./claude-plugin";
import {
  extractLookupIdFromToken,
  isExpiredSession,
  listIngestionKeys,
  mintIngestionKey,
} from "./cli-api";
import { assertCodexAgentGuidance } from "./codex-agents-md";
import { isIsolatedConfig, type GovernanceConfig } from "./config";
import { buildOtelEnvBlock, SOURCE_TYPE_BY_TOOL, telemetryEnvVarNames } from "./otel-env-block";
import { resolvePlatformToolPolicy } from "./platform-tool-policy";
import { runningCodeRestartNotice } from "./running-code";
import { installSessionContextHooks, removeSessionContextHooks } from "./session-context-hooks";
import {
  buildScopedToolFunction,
  type DetectedShell,
  assertCodexTurnHarvest,
  persistBlockToRc,
  rcHasLangwatchBlock,
  rcLangwatchBlockUrls,
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
  return `${normalizeEndpoint(controlPlaneUrl)}/api/otel`;
}

/**
 * Whether an unmarked env map (claude settings `env` block) carries langwatch-shaped OTLP
 * wiring this CLI could have written. An env pointing at another system is not ours and
 * must never be modified.
 */
export function otelWiringLooksLangwatchAuthored(env: Record<string, string>): boolean {
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
  /**
   * True when the platform rejected this device's session, so the cached key was reused
   * without confirming it is still live — wiring with a maybe-working key beats wiring
   * with nothing, but the caller must say so instead of reporting a working setup.
   */
  sessionExpired?: boolean;
}

/**
 * Resolve a live personal ingest key for `sourceType`: reuse the cached key only when the
 * platform confirms it is live, otherwise mint a fresh one (#4755); a rejected confirmation
 * falls back to the cache unless the caller opts out via `allowOfflineFallback: false`.
 */
export async function resolveLiveIngestionKey({
  cfg,
  sourceType,
  allowOfflineFallback = true,
}: {
  cfg: GovernanceConfig;
  sourceType: string;
  /**
   * Whether a `listIngestionKeys()` failure falls back to the cached secret.
   * Defaults true (#4755); the login-time refresh sets it false since the
   * cached secret there may be bound to a different instance (#6202).
   */
  allowOfflineFallback?: boolean;
}): Promise<IngestionKeyResolution> {
  const cached = cfg.default_personal_ingest_keys?.[sourceType];
  if (cached?.secret) {
    const cachedLookupId = extractLookupIdFromToken(cached.secret);
    if (cachedLookupId === undefined) {
      // Not a personal `ik-lw-` token: the user placed this credential
      // here by hand (a project `sk-lw-` key, a legacy shape). It cannot
      // be matched against the personal key listing, so probing it would
      // always read "revoked" and re-mint over the user's explicit
      // choice. Pinned: use as-is, never probe, never overwrite.
      return {
        token: cached.secret,
        prefix: cached.prefix,
        endpoint: otlpEndpointFor(cfg.control_plane_url),
        minted: false,
      };
    }
    let cacheIsLive = true; // assume live; falsified when server confirms otherwise
    let sessionExpired = false;
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
    } catch (error) {
      // Network error / older server: offline-first fallback reuses the cache
      // unless disabled. A rejected session confirms nothing about the key, so
      // the fallback still hands it back but marks sessionExpired so the
      // caller can say the key may be dead rather than reporting it live.
      sessionExpired = isExpiredSession(error);
      cacheIsLive = allowOfflineFallback;
    }
    if (cacheIsLive) {
      return {
        token: cached.secret,
        prefix: cached.prefix,
        endpoint: otlpEndpointFor(cfg.control_plane_url),
        minted: false,
        ...(sessionExpired ? { sessionExpired: true } : {}),
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

export interface IngestionCredentialResolution extends IngestionKeyResolution {
  /** Where the credential is scoped: the personal workspace or a pinned project. */
  scope: "personal" | "project";
  /** Slug (preferred) or id of the pinned project; unset for pasted keys. */
  projectLabel?: string;
}

/**
 * Resolve the ingest credential for a tool: the project pin when one exists
 * (`tool_project_keys[tool]`), else the personal path via `resolveLiveIngestionKey`. A pin
 * is used verbatim with no server round trip — it may belong to a project the device can't list.
 */
export async function resolveIngestionCredential({
  cfg,
  tool,
  sourceType,
  allowOfflineFallback = true,
}: {
  cfg: GovernanceConfig;
  tool: string;
  sourceType: string;
  allowOfflineFallback?: boolean;
}): Promise<IngestionCredentialResolution> {
  const pinned = cfg.tool_project_keys?.[tool];
  if (pinned?.secret) {
    return {
      token: pinned.secret,
      endpoint: otlpEndpointFor(pinned.endpoint ?? cfg.control_plane_url),
      minted: false,
      scope: "project",
      projectLabel: pinned.project_slug ?? pinned.project_id,
    };
  }
  const personal = await resolveLiveIngestionKey({
    cfg,
    sourceType,
    allowOfflineFallback,
  });
  return { ...personal, scope: "personal" };
}

/**
 * Re-sync the langwatch-authored env block in `~/.claude/settings.json`, firing only when
 * a langwatch-shaped block is already present. Also removes (never asserts) the
 * session-context seam when the LangWatch plugin is present, since its hooks run twice otherwise.
 */
export function refreshClaudeUserTelemetryEnv({
  vars,
}: {
  vars: Record<string, string>;
}): string | null {
  const target = appSettingsTargetFor("claude");
  if (!target) return null;
  const varNames = Object.keys(vars);
  if (!appEnvHasAnyVar(target, varNames)) return null;
  const current = appEnvValues(target);
  if (!otelWiringLooksLangwatchAuthored(current)) return null;
  try {
    if (readClaudePluginState().pluginInstalled) {
      removeSessionContextHooks({ tool: "claude_code" });
    } else {
      installSessionContextHooks({ tool: "claude_code" });
    }
  } catch {
    // The env is the refresh that matters; the seam is best-effort.
    void 0;
  }
  if (appEnvHasAllVars(target, vars)) return null;
  installAppEnv(target, vars);
  return `claude telemetry env (${target.displayPath})`;
}

/**
 * Re-sync the scoped `<tool>()` shell functions (gemini / opencode) across every supported
 * rc file. A marker pair is explicit langwatch authorship, so a present block whose body
 * doesn't carry the current endpoint + Authorization header is rewritten in place.
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
  const requiredKeys = [vars.OTEL_EXPORTER_OTLP_ENDPOINT, vars.OTEL_EXPORTER_OTLP_HEADERS].filter(
    (v): v is string => Boolean(v),
  );
  for (const shell of REFRESH_SHELLS) {
    if (!rcHasLangwatchBlock({ shell, markers })) continue;
    if (rcHasLangwatchBlock({ shell, markers, requiredKeys })) continue;
    persistBlockToRc(shell, buildScopedToolFunction(tool, vars, shell), markers);
    labels.push(`${tool} shell function (${tildify(rcPath(shell))})`);
  }
  return labels;
}

/**
 * Re-sync the langwatch `[otel]` marker block in codex's config.toml with the given
 * endpoint + token, preserving whether the Authorization header was persisted. Only
 * fires when the block is already present.
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
  const codexConfigPath = defaultCodexConfigPath();
  if (!codexHasOtelBlock(codexConfigPath)) return null;
  const result = writeCodexOtelBlock({
    baseEndpoint: endpoint,
    ingestionToken: token,
    environment,
  });
  // The exporters carry no conversation; the harvest recovers it, so a
  // refresh that keeps the exporters healthy heals the harvest wiring too
  // (idempotent and quiet while the notify block is already in place).
  assertCodexTurnHarvest();
  assertCodexAgentGuidance();
  if (result.action === "unchanged") return null;
  return `codex [otel] block (${displayCodexConfigPath()})`;
}

export type ClaudeProjectPinAction = "created" | "updated" | "unchanged" | "skipped";

export interface ClaudeProjectPinResult {
  action: ClaudeProjectPinAction;
  path: string;
  displayPath: string;
}

/**
 * Write (or re-sync) telemetry env into `.claude/settings.local.json`, which Claude Code
 * applies above user-level settings so a wrapped run always emits to the login that spawned
 * it. `skipped` means the file already carries non-langwatch OTLP wiring the user owns.
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
 * Strip the langwatch telemetry env from `.claude/settings.local.json` when present and
 * langwatch-shaped. Used by gateway-mode wrapper runs (capture + a live exporter would
 * double-trace) and by `langwatch logout`. Deletes the file (and empty `.claude` dir) when empty.
 */
export function removeClaudeProjectTelemetryPin({ cwd }: { cwd: string }): boolean {
  const target = claudeProjectSettingsTarget(cwd);
  const keys = telemetryEnvVarNames("claude");
  if (!appEnvHasAnyVar(target, keys)) return false;
  const envValues = appEnvValues(target);
  if (!otelWiringLooksLangwatchAuthored(envValues)) return false;
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
    void 0;
  }
}

/**
 * Best-effort: keep the pin (it carries an ingest key) out of history via
 * `.git/info/exclude` — local-only, the same mechanism Claude Code uses for this file.
 * Resolves the common git dir so worktrees share it; no-ops outside a repo or without git.
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
      void 0;
    }
    const existingLines = existing.split("\n");
    for (const l of existingLines) {
      if (l.trim() === line) return;
    }
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(excludePath, `${existing}${sep}${line}\n`);
  } catch {
    // The pin still works untracked; excluding it is a courtesy.
    void 0;
  }
}

function claudeUserWiringNeedsRefresh(expectedEndpoint: string): boolean {
  const target = appSettingsTargetFor("claude");
  if (!target) return false;
  const claudeVarNames = telemetryEnvVarNames("claude");
  if (!appEnvHasAnyVar(target, claudeVarNames)) return false;
  const current = appEnvValues(target);
  if (!otelWiringLooksLangwatchAuthored(current)) return false;
  return current.OTEL_EXPORTER_OTLP_ENDPOINT !== expectedEndpoint;
}

function codexOtelWiringNeedsRefresh(expectedEndpoint: string): boolean {
  const configPath = defaultCodexConfigPath();
  if (!codexHasOtelBlock(configPath)) return false;
  return codexOtelBlockEndpoint(configPath) !== codexTraceEndpoint(expectedEndpoint);
}

function scopedShellFunctionNeedsRefresh(tool: string, expectedEndpoint: string): boolean {
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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True for an endpoint served from this machine. Unparseable reads as not. */
export function isLoopbackEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(endpoint).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Whether a tool's persisted wiring reports to an instance on this machine.
 * A scoped shell function carries no parsed endpoint, so every address in
 * its block is parsed and judged by its host.
 */
function toolWiringPointsAtLoopback(tool: string): boolean {
  if (tool === "claude") {
    const target = appSettingsTargetFor("claude");
    if (!target) return false;
    return isLoopbackEndpoint(appEnvValues(target).OTEL_EXPORTER_OTLP_ENDPOINT);
  }
  if (tool === "codex") {
    return isLoopbackEndpoint(codexOtelBlockEndpoint(defaultCodexConfigPath()) ?? undefined);
  }
  const markers = toolMarkers(tool);
  return REFRESH_SHELLS.some((shell) =>
    rcLangwatchBlockUrls({ shell, markers }).some(isLoopbackEndpoint),
  );
}

/** A tool whose wiring reports to another deployment, which a local login keeps. */
function keepsWiringForLoopback(tool: string, expectedEndpoint: string): boolean {
  if (!toolWiringNeedsLoginRefresh(tool, expectedEndpoint)) return false;
  return !toolWiringPointsAtLoopback(tool);
}

function toolWiringNeedsLoginRefresh(tool: string, expectedEndpoint: string): boolean {
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
  /** Restart advice when a live launcher predates successfully changed wiring. */
  warnings?: string[];
  /**
   * Tools whose wiring points at another instance and was left alone, with
   * the reason: this login lives in a config of its own, or it is a login on
   * this machine and the wiring reports to a deployment elsewhere.
   */
  kept?: { tools: string[]; reason: "isolated_config" | "loopback_login" };
}

function ensureCodexHooks(): void {
  if (!codexHasOtelBlock(defaultCodexConfigPath())) return;
  assertCodexTurnHarvest();
  assertCodexAgentGuidance();
}

function rewriteToolWiring({
  cfg,
  tool,
  key,
  labels,
  warnings,
}: {
  cfg: GovernanceConfig;
  tool: string;
  key: Awaited<ReturnType<typeof resolveLiveIngestionKey>>;
  labels: string[];
  warnings: string[];
}): void {
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
    const refreshed = refreshScopedShellFunctions({ tool, vars });
    labels.push(...refreshed);
    if (tool === "code" && refreshed.length > 0) {
      const notice = runningCodeRestartNotice();
      if (notice) warnings.push(notice);
    }
  }
}

/** Refreshes one tool's stale wiring for the new login; true when it minted a key. */
async function refreshToolForLogin({
  cfg,
  tool,
  sourceType,
  expectedEndpoint,
  loopbackLogin,
  keptForLoopback,
  labels,
  warnings,
}: {
  cfg: GovernanceConfig;
  tool: string;
  sourceType: string;
  expectedEndpoint: string;
  loopbackLogin: boolean;
  keptForLoopback: string[];
  labels: string[];
  warnings: string[];
}): Promise<boolean> {
  if (!resolvePlatformToolPolicy(tool, cfg.tool_policies).allowOtelDirect) {
    // The new org forbids direct OTLP for this tool; the wrapper
    // surfaces that on the next run rather than login guessing.
    return false;
  }
  // A login on this machine leaves a tool that reports elsewhere wholly
  // alone: the hook names this CLI's own path, which is no business of a
  // config file this login does not take over.
  if (loopbackLogin && keepsWiringForLoopback(tool, expectedEndpoint)) {
    keptForLoopback.push(tool);
    return false;
  }
  // codex's notify hook recovers the conversation, and its guidance tells a session to
  // declare the checkout it moved to. Neither names an endpoint or a key, so both stand
  // ahead of the pin check — a pinned codex needs them exactly as a personal one does.
  // A config already pointing at this login skips the refresh below, so a device whose
  // [otel] block predates either would never be given one; both calls are idempotent.
  if (tool === "codex") ensureCodexHooks();
  if (cfg.tool_project_keys?.[tool]?.secret) {
    // Project-pinned wiring is deliberate scope, not stale personal
    // wiring; a new login never re-points it at the personal path.
    return false;
  }
  if (!toolWiringNeedsLoginRefresh(tool, expectedEndpoint)) return false;
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
      ...cfg.default_personal_ingest_keys,
      [sourceType]: { secret: key.token, prefix: key.prefix },
    };
  }
  try {
    rewriteToolWiring({ cfg, tool, key, labels, warnings });
  } catch {
    // Best-effort per tool: the key minted above stays cached.
    void 0;
  }
  return key.minted;
}

/**
 * Path A: the codex gateway provider block pins the gateway URL of the login
 * that wrote it. Re-sync it with this login's gateway URL when present.
 */
function resyncCodexGatewayBlock({
  cfg,
  loopbackLogin,
  keptForLoopback,
  labels,
}: {
  cfg: GovernanceConfig;
  loopbackLogin: boolean;
  keptForLoopback: string[];
  labels: string[];
}): void {
  try {
    const codexConfigPath = defaultCodexConfigPath();
    const keepsGatewayBlock =
      loopbackLogin && !isLoopbackEndpoint(codexGatewayBlockBaseUrl() ?? undefined);
    if (!codexHasGatewayBlock(codexConfigPath)) {
      // Nothing to re-sync.
    } else if (keepsGatewayBlock) {
      if (!keptForLoopback.includes("codex")) keptForLoopback.push("codex");
    } else {
      const result = writeCodexGatewayBlock({ gatewayUrl: cfg.gateway_url });
      if (result.action !== "unchanged") {
        labels.push(`codex gateway block (${displayCodexConfigPath()})`);
      }
    }
  } catch {
    // Best-effort, same as the per-tool refresh.
    void 0;
  }
}

/**
 * Login-time half of latest-login-wins: refresh any langwatch-authored block whose endpoint
 * differs from the new control plane; a block already pointing here is left for the next
 * wrapper run to re-sync. Best-effort — per-tool failures skip that tool, never the login.
 */
export async function refreshTelemetryWiringForLogin(
  cfg: GovernanceConfig,
): Promise<LoginTelemetryRefreshResult> {
  const labels: string[] = [];
  let mintedAny = false;
  const warnings: string[] = [];
  const expectedEndpoint = otlpEndpointFor(cfg.control_plane_url);

  if (isIsolatedConfig()) {
    const tools = Object.keys(SOURCE_TYPE_BY_TOOL).filter((tool) => {
      try {
        return toolWiringNeedsLoginRefresh(tool, expectedEndpoint);
      } catch {
        return false;
      }
    });
    return {
      labels,
      mintedAny,
      ...(tools.length > 0 ? { kept: { tools, reason: "isolated_config" as const } } : {}),
    };
  }

  const loopbackLogin = isLoopbackEndpoint(expectedEndpoint);
  const keptForLoopback: string[] = [];

  for (const [tool, sourceType] of Object.entries(SOURCE_TYPE_BY_TOOL)) {
    try {
      const minted = await refreshToolForLogin({
        cfg,
        tool,
        sourceType,
        expectedEndpoint,
        loopbackLogin,
        keptForLoopback,
        labels,
        warnings,
      });
      if (minted) mintedAny = true;
    } catch {
      // Best-effort per tool: one failed mint must not block the login
      // or the other tools' refreshes.
      void 0;
    }
  }

  resyncCodexGatewayBlock({ cfg, loopbackLogin, keptForLoopback, labels });

  return {
    labels,
    mintedAny,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(keptForLoopback.length > 0
      ? { kept: { tools: keptForLoopback, reason: "loopback_login" as const } }
      : {}),
  };
}

/** The lines the login prints for wiring it left alone. Exported for tests. */
export function keptWiringLines(kept: NonNullable<LoginTelemetryRefreshResult["kept"]>): string[] {
  const tools = kept.tools.join(", ");
  if (kept.reason === "isolated_config") {
    return [
      `Left the wiring of ${tools} as it is: this login lives in its own config file (LANGWATCH_CLI_CONFIG), so it is not this machine's login.`,
    ];
  }
  const example = kept.tools[0] ?? "claude";
  return [
    `Left the wiring of ${tools} as it is: it reports to another LangWatch, and a login on this machine does not take it over.`,
    `To report to this one instead, run the tool through it once: langwatch ${example}`,
  ];
}

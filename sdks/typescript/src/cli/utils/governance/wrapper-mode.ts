/**
 * Wrapper mode selection: gateway mode (VK present) captures I/O server-side;
 * ingestion mode (no VK) emits OTel from the child instead. The two are
 * mutually exclusive — both would double-count the same call's traces and cost.
 */

import * as os from "node:os";

import { writeCodexGatewayBlock, writeCodexOtelBlock } from "@/cli/utils/codex-config-toml";
import { setOpencodeOpenTelemetryFlag } from "@/cli/utils/opencode-config-flag";

import { claudeProjectSettingsTarget } from "./app-settings";
import { lwTag } from "./brand";
import { GovernanceCliError, issuePersonalVirtualKey } from "./cli-api";
import { assertCodexAgentGuidance } from "./codex-agents-md";
import type { GovernanceConfig } from "./config";
import { saveConfig } from "./config";
import { deviceLabelForThisMachine } from "./device-label";
import { warnIfGeminiOAuthSelected } from "./gemini-settings-preflight";
import { buildOtelEnvBlock, SOURCE_TYPE_BY_TOOL } from "./otel-env-block";
import { resolvePlatformToolPolicy } from "./platform-tool-policy";
import { runningCodeRestartNotice } from "./running-code";
import { SHELL_FUNCTION_TOOLS, assertCodexTurnHarvest } from "./shell-rc";
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
 * Copilot is the one tool where the gateway changes WHO PAYS: BYOK routing bills the org's
 * provider keys while the user's Copilot seat sits idle (ADR-039 Decision 3).
 * Every mid-run fallback onto the gateway appends this so the shift is named, never silent.
 */
export function copilotSeatBypassSuffix(tool: string): string {
  if (tool !== "copilot") return "";
  return " NOTE: gateway usage bills your org's provider keys, not your Copilot seat.";
}

/**
 * OTel booleans are case-insensitive, and this repo's sibling parsers honour
 * "0"/"no"/"off" too — skip any and capture silently re-enables (privacy
 * regression). Unset means "not opted out" (default-on).
 */
function isCaptureOptOut(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ["false", "0", "no", "off"].includes(raw.trim().toLowerCase());
}

/**
 * Catches any error so a housekeeping failure can never crash the wrapped
 * tool launch — the same best-effort guarantee the login-time refresh
 * gives. Warns to stderr and returns `fallback`.
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
   * Path of the sibling profile file (~/.codex/langwatch-gateway.config.toml).
   * Set only on codex Path A: codex 0.134+ requires the profile body in a
   * separate file when --profile is passed.
   */
  codexProfilePath?: string;
  /**
   * Extra args to prepend to the child invocation. Used for codex
   * Path A: `--profile langwatch-gateway` forces the new provider
   * entry without touching the user's default model_provider.
   */
  extraArgs?: string[];
  /**
   * Env-var names to strip before merging the wrapper's vars in — propagated
   * from `ToolEnv.clears` so a legacy-twin var (e.g. claude's
   * `ANTHROPIC_API_KEY`) doesn't collide with the one this wrapper sets.
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
   * Path B (ingestion) only. Used AFTER the child exits to POST codex's
   * recovered turn input/output (from the rollout transcript) onto codex's
   * own trace_ids, since codex never puts content on the wire itself.
   */
  endpoint?: string;
  ingestionToken?: string;
  /**
   * One-line notice printed to stderr when platform policy changed the
   * resolved path (e.g. the org admin turned OTLP off for this tool), so
   * the member sees why the path differs from the default.
   */
  notice?: string;
  /**
   * Labels of persisted telemetry targets re-synced to this run's endpoint +
   * key because a previous install left stale values behind (latest login
   * wins, #6202). The wrapper surfaces one line per label.
   */
  refreshedWiring?: string[];
  /**
   * Written/refreshed in ingestion mode (project settings outrank
   * user-level, so the run can't be rerouted); removed in gateway mode
   * (capture + a live exporter would double-trace).
   */
  claudeProjectPin?: ClaudeProjectPinResult | { action: "removed"; path: string };
}

type ModeChoice = { mode: WrapperMode; notice: string | undefined };

/**
 * Effective mode: forcedMode wins, else a project pin means ingestion, else
 * the persisted tool_mode, else VK-present means gateway, else ingestion.
 * Platform policy then gates the result.
 */
function preferredMode({
  forcedMode,
  hasProjectPin,
  persistedMode,
  hasVk,
}: {
  forcedMode: WrapperMode | undefined;
  hasProjectPin: boolean;
  persistedMode: string | undefined;
  hasVk: boolean;
}): WrapperMode {
  if (forcedMode !== undefined) return forcedMode;
  if (hasProjectPin) return "ingestion";
  if (persistedMode === "gateway" || persistedMode === "ingestion") return persistedMode;
  return hasVk ? "gateway" : "ingestion";
}

/**
 * Self-heal a pinned gateway preference that can never be honored, or the
 * notice prints on every run forever (the gateway-side pin-forgetting in
 * wrapper.ts only runs on runs that STAY gateway).
 */
function forgetUnhonorableGatewayPin({ cfg, tool }: { cfg: GovernanceConfig; tool: string }): void {
  if (cfg.tool_mode?.[tool] === "gateway") {
    const { [tool]: _dropped, ...rest } = cfg.tool_mode;
    try {
      saveConfig({ ...cfg, tool_mode: rest });
      cfg.tool_mode = rest;
    } catch (error) {
      // best-effort — a persist failure just re-prints next run.
      void error;
    }
  }
}

function gatedMode({
  cfg,
  tool,
  policy,
  hasProjectPin,
  preferred,
}: {
  cfg: GovernanceConfig;
  tool: string;
  policy: ReturnType<typeof resolvePlatformToolPolicy>;
  hasProjectPin: boolean;
  preferred: WrapperMode;
}): ModeChoice {
  let mode = preferred;
  let notice: string | undefined;
  // Symmetric fallback: when the resolved mode is disabled but the other mode
  // is allowed, swap into it instead of throwing (e.g. cursor keeps working via
  // gateway with no VK yet). This gate sits above the ingestion-key mint below,
  // so a tool with direct OTLP disabled never mints one.
  if (mode === "gateway" && !policy.allowVk) {
    mode = "ingestion";
    // Blame accurately: a hardcoded platform policy (no org row — e.g.
    // `code`, which is ingestion-only by design) is a product fact, not
    // an admin decision.
    notice =
      cfg.tool_policies?.[tool] !== undefined
        ? `${lwTag()} gateway path is disabled for ${tool} by your org admin; using direct OTLP ingestion instead.`
        : `${lwTag()} ${tool} supports direct OTLP ingestion only; using it.`;
    forgetUnhonorableGatewayPin({ cfg, tool });
  }
  if (mode === "ingestion" && !policy.allowOtelDirect && !hasProjectPin) {
    mode = "gateway";
    notice = `${lwTag()} direct OTLP ingestion is disabled for ${tool} by your org admin; routing through the gateway instead.${copilotSeatBypassSuffix(tool)}`;
  }
  // A project-pinned tool never silently reroutes onto the gateway: that
  // would move telemetry (and billing) from the pinned team project to the
  // personal path. The mint guard below turns this into a clear error.
  return { mode, notice };
}

/** The personal virtual key, issued on the first run that takes the gateway path. */
async function ensurePersonalVk({
  cfg,
  tool,
  gatewayVars,
  gatewayClears,
}: {
  cfg: GovernanceConfig;
  tool: string;
  gatewayVars: Record<string, string>;
  gatewayClears: string[];
}): Promise<{ vars: Record<string, string>; clears: string[] }> {
  if (cfg.default_personal_vk?.secret) return { vars: gatewayVars, clears: gatewayClears };
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
  } catch (error) {
    // The in-memory key still serves this run; an unsaved config
    // means the next gateway run issues again.
    void error;
  }
  const refreshed = envForTool(cfg, tool);
  process.stderr.write(`${lwTag()} issued your personal virtual key for the gateway path.\n`);
  return { vars: refreshed.vars, clears: refreshed.clears ?? gatewayClears };
}

/**
 * The gateway captures this session server-side; a project pin left behind by
 * an earlier ingestion run would make claude ALSO emit OTLP (double-trace).
 */
function stripClaudeProjectPin(): { action: "removed"; path: string } | undefined {
  const cwd = process.cwd();
  const removed = tryRefresh(
    "the claude project telemetry pin",
    () => removeClaudeProjectTelemetryPin({ cwd }),
    false,
  );
  if (!removed) return undefined;
  return { action: "removed", path: claudeProjectSettingsTarget(cwd).path };
}

async function gatewayModeResult({
  cfg,
  tool,
  gatewayVars,
  gatewayClears,
  notice,
}: {
  cfg: GovernanceConfig;
  tool: string;
  gatewayVars: Record<string, string>;
  gatewayClears: string[];
  notice: string | undefined;
}): Promise<WrapperModeResult> {
  const mode = "gateway";
  // Structural guard: a tool with no gateway env shape must fail loudly
  // here, not launch with empty vars and no explanation. Probed with a
  // placeholder VK, since envForTool also returns empty when no VK is
  // stored yet — that case is handled by the lazy issue below.
  const probe = envForTool({ ...cfg, default_personal_vk: { secret: "vk-lw-probe" } }, tool);
  if (Object.keys(probe.vars).length === 0) {
    throw new GovernanceCliError(
      501,
      "gateway_unsupported",
      `The gateway path isn't implemented for '${tool}'. Run it with --tool-mode=otlp to use direct OTLP ingestion instead.`,
    );
  }
  const { vars: effectiveGatewayVars, clears: effectiveGatewayClears } = await ensurePersonalVk({
    cfg,
    tool,
    gatewayVars,
    gatewayClears,
  });
  if (tool === "gemini") {
    warnIfGeminiOAuthSelected();
  }
  // The gateway captures this session server-side; a project pin left
  // behind by an earlier ingestion run would make claude ALSO emit
  // OTLP (double-trace), and if that pin predates the current login it
  // would emit to the WRONG instance. Strip it for gateway runs.
  const claudeProjectPin = tool === "claude" ? stripClaudeProjectPin() : undefined;
  // Codex 0.130+ defers to ChatGPT OAuth and ignores OPENAI_API_KEY unless
  // the active model_provider is an explicit env-keyed entry, so we write
  // a langwatch provider + profile to ~/.codex/config.toml and force codex
  // into it via `--profile`.
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

/**
 * Latest login wins (#6202): claude applies settings.json env ON TOP of the
 * child env, and scoped shell functions shadow the binary in the login shell,
 * so a previous install's stale wiring is re-synced in place before spawn.
 */
function refreshStaleWiring({ tool, vars }: { tool: string; vars: Record<string, string> }): {
  refreshedWiring: string[];
  claudeProjectPin: ClaudeProjectPinResult | undefined;
} {
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
    // Every scoped-function tool (gemini/opencode/copilot) needs its rc
    // function re-synced per run: after a key re-mint the rc function would
    // keep serving the old token to bare `<tool>` invocations — silent
    // 401s forever (#6202 class). Login-time refresh only fires on
    // endpoint drift, not key drift.
    refreshedWiring.push(
      ...tryRefresh(
        `the ${tool} scoped shell function`,
        () => refreshScopedShellFunctions({ tool, vars }),
        [] as string[],
      ),
    );
  }
  return { refreshedWiring, claudeProjectPin };
}

/**
 * VS Code hardening, coupled to env INJECTION: every `code` run injects the
 * bearer into a long-lived editor whose terminals inherit it, so the terminal
 * clear is reapplied every run. ADR-039 §Extension #2.
 */
function clearVscodeTerminalEnv(vars: Record<string, string>): void {
  const vscodePlatform = process.platform;
  if (vscodePlatform === "darwin" || vscodePlatform === "linux" || vscodePlatform === "win32") {
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

function wireCodexOtel({
  cfg,
  endpoint,
  token,
}: {
  cfg: GovernanceConfig;
  endpoint: string;
  token: string;
}): string {
  // codex's OTLP/HTTP exporters send each signal to the endpoint verbatim
  // (no `/v1/traces` suffix like the Node/Python/Go SDKs add), so the block
  // writer spells both signal suffixes out. The Authorization header is
  // persisted inline since config.toml is the only wiring a plain
  // (unwrapped) `codex` run reads; `langwatch logout` removes the block.
  const result = writeCodexOtelBlock(
    {
      baseEndpoint: endpoint,
      ingestionToken: token,
      environment: cfg.organization?.slug ?? "langwatch",
    },
    { persistAuthHeader: true },
  );
  // The exporters carry no conversation; the turn harvest is what
  // recovers it, so the two are wired (and healed) together.
  assertCodexTurnHarvest();
  assertCodexAgentGuidance();
  return result.path;
}

/**
 * The tool_mode pin is written only when nothing forced the mode: a forced
 * mode owns its own persistence, and a silent default deliberately does not
 * persist, so the user is asked again next run.
 */
function persistIngestionChoice({
  cfg,
  tool,
  forcedMode,
  minted,
  sourceType,
  token,
}: {
  cfg: GovernanceConfig;
  tool: string;
  forcedMode: WrapperMode | undefined;
  minted: boolean;
  sourceType: string;
  token: string;
}): void {
  const next: GovernanceConfig = { ...cfg };
  if (forcedMode === undefined) {
    next.tool_mode = { ...cfg.tool_mode, [tool]: "ingestion" };
  }
  if (minted) {
    next.default_personal_ingest_keys = {
      ...cfg.default_personal_ingest_keys,
      [sourceType]: { secret: token },
    };
  }
  if (forcedMode === undefined || minted) {
    try {
      saveConfig(next);
    } catch (error) {
      // Best-effort cache - failure to persist doesn't block this run.
      void error;
    }
  }
}

/** A second notice, on its own line after the first. */
const joinNotice = (
  notice: string | undefined,
  extra: string | null | undefined,
): string | undefined => {
  if (!extra) return notice;
  return notice ? `${notice}\n${extra}` : extra;
};

/** Drops our capture flag when the environment opted out, and says what that costs. */
function applyCaptureOptOut({
  tool,
  vars,
}: {
  tool: string;
  vars: Record<string, string>;
}): string | undefined {
  if (tool !== "copilot" && tool !== "code") return undefined;
  if (!isCaptureOptOut(process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT)) {
    return undefined;
  }
  delete vars.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
  return `${lwTag()} content capture is disabled in your environment (OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT is falsey); ${tool} traces will carry tokens only.`;
}

/**
 * Does NOT prompt — path selection lives upstream in `resolveWrapperPath`.
 * Platform policy still GATES the resolved mode regardless of how it was
 * chosen, so a forced mode the admin disabled downgrades like an unforced one.
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

  const choice = gatedMode({
    cfg,
    tool,
    policy,
    hasProjectPin,
    preferred: preferredMode({ forcedMode, hasProjectPin, persistedMode, hasVk }),
  });
  const { mode } = choice;
  let { notice } = choice;

  if (mode === "gateway") {
    return gatewayModeResult({ cfg, tool, gatewayVars, gatewayClears, notice });
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

  // Resolve the ingest credential: project pin, else cached personal
  // `ik-lw-` key if still live, else a fresh mint. The mint route returns
  // the plaintext key once, so it's persisted to the per-tool cache below
  // and read back rather than re-minted.
  const { token, endpoint, minted, scope, projectLabel } = await resolveIngestionCredential({
    cfg,
    tool,
    sourceType,
  });

  const vars = buildOtelEnvBlock(tool, endpoint, token);

  // Copilot content-capture opt-out: the capture flag is a STANDARD OTel
  // GenAI env var, so an explicit "false" from the user/enterprise policy
  // is never overridden — dropping our "true" lets it win in the spawn
  // merge; the notice makes the tokens-only consequence visible (ADR-039 D5).
  notice = joinNotice(notice, applyCaptureOptOut({ tool, vars }));

  // Latest login wins (#6202): claude applies settings.json env ON TOP of
  // the child env, and scoped shell functions shadow the binary in the
  // login shell, so a previous install's stale wiring would override this
  // run's env. Re-synced in place before spawn; codex gets the same
  // treatment via its unconditional [otel] write below.
  const { refreshedWiring, claudeProjectPin } = refreshStaleWiring({ tool, vars });
  if (tool === "code" && refreshedWiring.length > 0) {
    notice = joinNotice(notice, runningCodeRestartNotice());
  }

  // VS Code hardening, coupled to env INJECTION (not shell-rc persistence
  // consent): every `code` run injects the bearer into a long-lived editor
  // whose terminals inherit it, so the terminal clear must be reapplied
  // every run — declining the rc function must not leave terminals
  // inheriting the token. ADR-039 §Extension #2.
  if (tool === "code") clearVscodeTerminalEnv(vars);

  const codexConfigPath = tool === "codex" ? wireCodexOtel({ cfg, endpoint, token }) : undefined;

  if (tool === "opencode") {
    // opencode only EMITS spans when `experimental.openTelemetry` is true
    // in opencode.jsonc; without it the OTEL_EXPORTER_OTLP_* vars we set
    // below are accepted-and-ignored, so Path B silently produces nothing.
    // Idempotent merge: no write if already on, and an explicit false is
    // never overwritten.
    setOpencodeOpenTelemetryFlag();
  }

  // The tool_mode pin is written only when nothing forced the mode: a forced
  // mode already owns its own persistence, and a silent default (non-TTY,
  // aborted prompt) deliberately does not persist, so the user is asked again
  // next run instead of getting silently pinned forever.
  persistIngestionChoice({ cfg, tool, forcedMode, minted, sourceType, token });

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
 * Scrubs copilot's BYOK provider vars in ingestion mode: hand-exported,
 * they'd keep BYOK active and double-capture against the OTLP lane.
 * Gateway mode scrubs its own conflicting twins; this is the counterpart.
 */
function ingestionClears(tool: string): string[] {
  if (tool === "copilot") {
    return ["COPILOT_PROVIDER_TYPE", "COPILOT_PROVIDER_BASE_URL", "COPILOT_PROVIDER_API_KEY"];
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

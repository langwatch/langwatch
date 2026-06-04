/**
 * Wrapper mode selection — Path A (gateway) vs Path B (ingestion).
 *
 * Decides, before each `langwatch <tool>` invocation, which routing
 * shape to apply:
 *
 *   - Path A (gateway): VK present + provider configured + user
 *     hasn't opted out -> inject the base-URL swap envs from
 *     envForTool(). Gateway captures I/O server-side; no OTel
 *     emission from the child.
 *   - Path B (ingestion): no VK (Claude Max-style subscription,
 *     user explicitly opted in) -> mint/rotate the user's
 *     UserIngestionBinding for this template, write the [otel]
 *     activation block to ~/.codex/config.toml (codex only),
 *     return the OTel exporter env block for the child.
 *
 * The two modes are mutually exclusive per the no-double-trace
 * rule — gateway capture + OTel emission of the same call would
 * double-count both traces and cost.
 *
 * Persisted preference lives at cfg.tool_mode[tool]; an unset
 * entry resolves at runtime as "gateway if VK present else
 * ingestion" with no prompt. Future iterations can layer a
 * first-run prompt similar to shell-rc.ts on top.
 */

import {
  writeCodexGatewayBlock,
  writeCodexOtelBlock,
} from "@/cli/utils/codex-config-toml";

import type { GovernanceConfig } from "./config";
import { saveConfig } from "./config";
import {
  GovernanceCliError,
  installUserIngestionBinding,
  listIngestionTemplates,
  listUserIngestionBindings,
  rotateUserIngestionBindingToken,
} from "./cli-api";

export type WrapperMode = "gateway" | "ingestion";

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
  /** True when the wrapper minted a fresh binding (vs reused an existing). */
  newBindingMinted?: boolean;
}

const SOURCE_TYPE_BY_TOOL: Record<string, string> = {
  claude: "claude_code",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
};

/**
 * Resolve mode for a single tool invocation. Returns the env block
 * the wrapper should hand to the child process. May persist
 * `tool_mode[tool]` + a refreshed ingestion token cache to
 * ~/.langwatch/config.json as a side effect.
 *
 * Does NOT prompt the user — defaults are picked from cfg state.
 * Layering an interactive prompt for the "ask" state lives in a
 * future shell-rc-shaped helper (mode_preference, "save", "never").
 */
export async function resolveWrapperMode(
  cfg: GovernanceConfig,
  tool: string,
  gatewayVars: Record<string, string>,
): Promise<WrapperModeResult> {
  const persistedMode = cfg.tool_mode?.[tool];
  const hasVk = !!cfg.default_personal_vk?.secret;

  // EFFECTIVE mode rules:
  //   persisted="gateway"   -> gateway (even if VK absent; preflight surfaces the gap)
  //   persisted="ingestion" -> ingestion
  //   persisted="ask" / unset:
  //     hasVk -> gateway (no surprise: VK users keep current behavior)
  //     no VK -> ingestion (auto-install Path B; closes the "$5 VPS" scenario)
  const mode: WrapperMode =
    persistedMode === "gateway"
      ? "gateway"
      : persistedMode === "ingestion"
        ? "ingestion"
        : hasVk
          ? "gateway"
          : "ingestion";

  if (mode === "gateway") {
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
        codexConfigPath: gw.path,
        codexProfilePath: gw.profilePath,
        extraArgs: ["--profile", gw.profile],
      };
    }
    return { mode, vars: gatewayVars };
  }

  // INGESTION mode: ensure binding + (for codex) toml.
  const sourceType = SOURCE_TYPE_BY_TOOL[tool];
  if (!sourceType) {
    // No ingestion template defined for this tool (cursor is the
    // current example — GUI app, no useful OTel). Fall through to
    // gateway shape; the existing preflight will tell the user
    // what's missing.
    return { mode: "gateway", vars: gatewayVars };
  }

  const templates = await listIngestionTemplates(cfg);
  const template = templates.find((t) => t.slug === sourceType);
  if (!template) {
    throw new GovernanceCliError(
      404,
      "ingestion_template_not_found",
      `No IngestionTemplate found with slug '${sourceType}'. The catalog seed may not have run on this control plane yet.`,
    );
  }

  const bindings = await listUserIngestionBindings(cfg);
  const prior = bindings.find((b) => b.template_id === template.id);

  let token: string;
  let minted: boolean;
  if (prior) {
    const r = await rotateUserIngestionBindingToken(cfg, prior.id);
    token = r.binding_access_token;
    minted = false;
  } else {
    const r = await installUserIngestionBinding(cfg, template.id);
    token = r.binding_access_token;
    minted = true;
  }

  const endpoint = `${cfg.control_plane_url.replace(/\/+$/, "")}/api/otel`;
  const vars = buildOtelEnvBlock(tool, endpoint, token);

  let codexConfigPath: string | undefined;
  if (tool === "codex") {
    // codex's OTLP/HTTP exporter sends every signal to the configured
    // endpoint verbatim — it does NOT append `/v1/traces` the way the
    // OTel SDKs in Node/Python/Go do. Spell the trace-signal suffix
    // out here so the POST lands on the real handler. codex only
    // emits traces today (no logs/metrics), so one suffix suffices.
    const result = writeCodexOtelBlock({
      endpoint: `${endpoint}/v1/traces`,
      ingestionToken: token,
      environment: cfg.organization?.slug ?? "langwatch",
    });
    codexConfigPath = result.path;
  }

  // Persist mode so the next invocation skips re-deriving it.
  const next: GovernanceConfig = {
    ...cfg,
    tool_mode: { ...(cfg.tool_mode ?? {}), [tool]: "ingestion" },
  };
  try {
    saveConfig(next);
  } catch {
    // Best-effort cache — failure to persist doesn't block this run.
  }

  return { mode, vars, codexConfigPath, newBindingMinted: minted };
}

function buildOtelEnvBlock(
  tool: string,
  endpoint: string,
  token: string,
): Record<string, string> {
  const base = {
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
  };

  switch (tool) {
    case "claude":
      return {
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        // Without this, Claude Code 2.1.x redacts the `prompt` attr on
        // its user_prompt event — the receiver-side fold has no input
        // text to lift into langwatch.input.value, so /me/traces shows
        // empty input even though tokens + model land correctly.
        OTEL_LOG_USER_PROMPTS: "1",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=claude-code",
      };
    case "codex":
      return {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=codex",
      };
    case "gemini":
      return {
        GEMINI_TELEMETRY_ENABLED: "true",
        GEMINI_TELEMETRY_TARGET: "local",
        GEMINI_TELEMETRY_OTLP_PROTOCOL: "http",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=gemini-cli",
      };
    case "opencode":
      return {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=opencode",
      };
    default:
      return base;
  }
}

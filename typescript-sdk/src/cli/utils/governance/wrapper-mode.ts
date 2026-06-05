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
import { setOpencodeOpenTelemetryFlag } from "@/cli/utils/opencode-config-flag";

import type { GovernanceConfig } from "./config";
import { saveConfig } from "./config";
import {
  GovernanceCliError,
  installUserIngestionBinding,
} from "./cli-api";
import { warnIfGeminiOAuthSelected } from "./gemini-settings-preflight";
import { resolvePlatformToolPolicy } from "./platform-tool-policy";

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
  gatewayClears: string[] = [],
): Promise<WrapperModeResult> {
  const persistedMode = cfg.tool_mode?.[tool];
  const hasVk = !!cfg.default_personal_vk?.secret;
  const policy = resolvePlatformToolPolicy(tool, cfg.tool_policies);

  if (!policy.allowVk && !policy.allowOtelDirect) {
    throw new GovernanceCliError(
      403,
      "tool_disabled",
      `Tool '${tool}' is disabled in the platform policy (both gateway and direct OTLP paths off). Ask your org admin to enable allow_vk or allow_otel_direct.`,
    );
  }

  // EFFECTIVE mode rules:
  //   persisted="gateway"   -> gateway (even if VK absent; preflight surfaces the gap)
  //   persisted="ingestion" -> ingestion
  //   persisted="ask" / unset:
  //     hasVk -> gateway (no surprise: VK users keep current behavior)
  //     no VK -> ingestion (auto-install Path B; closes the "$5 VPS" scenario)
  //
  // Platform policy then GATES the resolved mode:
  //   - mode=gateway + !allowVk -> downgrade to ingestion (if allowed) or error
  //   - mode=ingestion + !allowOtelDirect -> error (no automatic upgrade
  //     to gateway since the user explicitly opted in or has no VK)
  let mode: WrapperMode =
    persistedMode === "gateway"
      ? "gateway"
      : persistedMode === "ingestion"
        ? "ingestion"
        : hasVk
          ? "gateway"
          : "ingestion";

  // Symmetric fall-back: when the resolved mode is disabled but the
  // OTHER mode is allowed, swap into it rather than throwing. Lets
  // cursor (allowVk=true, allowOtelDirect=false) keep working via
  // gateway when no VK is yet configured (preflight surfaces the
  // missing VK separately, same as before this gate existed).
  if (mode === "gateway" && !policy.allowVk) {
    mode = "ingestion";
  }
  if (mode === "ingestion" && !policy.allowOtelDirect) {
    mode = "gateway";
  }

  if (mode === "gateway") {
    if (tool === "gemini") {
      warnIfGeminiOAuthSelected();
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
      };
    }
    return { mode, vars: gatewayVars, clears: gatewayClears };
  }

  // INGESTION mode: ensure binding + (for codex) toml.
  const sourceType = SOURCE_TYPE_BY_TOOL[tool];
  if (!sourceType) {
    // No source slug defined for this tool (cursor is the current
    // example — GUI app, no useful OTel). Fall through to gateway shape;
    // the existing preflight will tell the user what's missing.
    return { mode: "gateway", vars: gatewayVars, clears: gatewayClears };
  }

  // The unified coding assistants are NOT ingestion templates — the
  // platform owns their whole setup and the receiver converts their OTLP
  // model-call logs into canonical gen_ai spans. So we mint a
  // template-free binding keyed by sourceType. The server install is an
  // idempotent upsert on (personalProjectId, sourceType): a repeat
  // `langwatch <tool>` rotates the token in place instead of 409'ing, so
  // no list/rotate-vs-install branching is needed here.
  const r = await installUserIngestionBinding(cfg, { sourceType });
  const token = r.binding_access_token;

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

  if (tool === "opencode") {
    // opencode constructs its OTLP exporter but only EMITS spans when
    // `experimental.openTelemetry` is true in ~/.config/opencode/opencode.jsonc.
    // Without this the OTEL_EXPORTER_OTLP_* env vars we set below are
    // accepted-and-ignored — Path B silently produces nothing. Idempotent
    // merge: if the user already turned it on, no write; if they
    // explicitly set false, we don't overwrite their intent.
    setOpencodeOpenTelemetryFlag();
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

  // The idempotent install always issues a fresh token (shown once), so
  // from the user's perspective a binding token was minted this run.
  return { mode, vars, codexConfigPath, newBindingMinted: true };
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
      // Three further OTel unlock knobs found in the claude-code 2.x
      // bundled binary string sweep (alongside OTEL_LOG_USER_PROMPTS
      // which we already set), all four officially documented on
      // code.claude.com/docs/en/monitoring-usage:
      //   OTEL_LOG_TOOL_DETAILS  — lifts tool_input / tool_parameters
      //     attrs (Bash command text, Edit diffs, Read file paths,
      //     etc) onto tool_decision + tool_result events. The
      //     receiver-side previously had only `tool_input_size_bytes`
      //     and `tool_result_size_bytes` — proven across the
      //     andre-claude-tool-calls + sergey-third-eye dump set.
      //   OTEL_LOG_TOOL_CONTENT  — TRACES-ONLY + requires beta
      //     tracing. claude 2.x is LOGS-ONLY today so this is a
      //     no-op for us. Set anyway as forward-compat for when
      //     claude turns on traces. Tool I/O on the logs path
      //     actually comes from TOOL_DETAILS + RAW_API_BODIES.
      //   OTEL_LOG_RAW_API_BODIES — emits two NEW event types
      //     `api_request_body` + `api_response_body` carrying the
      //     FULL JSON of every message (system prompts + user content
      //     + assistant text + tool_use blocks). THIS IS THE ONLY
      //     surface that carries the assistant response text — every
      //     other event (api_request, user_prompt, tool_*) is
      //     metadata only. Andre's live-dogfood (proxy intercept on
      //     :4318) found "UNLOCK-KNOBS-TEST-PROOF-7777" in
      //     api_response_body.content[].text with this flag set. Also
      //     the heaviest payload class (system prompts can be 100KB+,
      //     message history grows turn-over-turn) — same fat-payload
      //     class as the CH merge memory-ceiling incident
      //     [[project_skai_ch_merge_memory_ceiling_outage]].
      //
      // Default policy: ALL FOUR knobs ON. rchaves "fix everything,
      // collect all humanly possible". Payload risk is bounded:
      // claude 2.x caps api_request_body + api_response_body at 60KB
      // INLINE per event (inline is the default; the optional
      // file:<dir> mode that writes untruncated bodies to disk is NOT
      // enabled). Alexis ships a complementary receiver-side guard
      // in the same PR as defense-in-depth on fold accumulation +
      // a Body cap in case future claude versions remove the 60KB
      // inline limit. PII / logging-opt-out controls already live on
      // the platform settings page. Note: extended-thinking content
      // is ALWAYS redacted by claude from raw bodies — we cannot
      // capture it regardless of flag state.
      return {
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        OTEL_LOG_USER_PROMPTS: "1",
        OTEL_LOG_TOOL_DETAILS: "1",
        OTEL_LOG_TOOL_CONTENT: "1",
        OTEL_LOG_RAW_API_BODIES: "1",
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
      // gemini-cli 0.46 telemetry resolver (packages/core/dist/src/telemetry/config.js):
      //   target ∈ {local, gcp} — NOT otlp. The JSON-schema doc string
      //   mentions otlp as an "example", but the runtime validator
      //   (parseTelemetryTargetValue) only accepts local|gcp; passing
      //   otlp throws FatalConfigError at startup.
      //   To forward spans + log records to our OTLP endpoint we use
      //   `local` (in-process exporters) + `useCollector=true` which
      //   routes through @opentelemetry/exporter-trace-otlp-http +
      //   exporter-logs-otlp-http to GEMINI_TELEMETRY_OTLP_ENDPOINT
      //   (falls back to OTEL_EXPORTER_OTLP_ENDPOINT).
      //   `traces=true` enables the detail-attribute span path so the
      //   user prompt + tool calls land as span attributes (not just
      //   token counts).
      //   `logPrompts=true` is what makes gemini-cli embed the actual
      //   user prompt text in the user_prompt event — without it the
      //   receiver-side fold has no input text to lift onto
      //   langwatch.input.value, same class as claude-code.
      return {
        GEMINI_TELEMETRY_ENABLED: "true",
        GEMINI_TELEMETRY_TARGET: "local",
        GEMINI_TELEMETRY_USE_COLLECTOR: "true",
        GEMINI_TELEMETRY_TRACES_ENABLED: "true",
        GEMINI_TELEMETRY_OTLP_PROTOCOL: "http",
        GEMINI_TELEMETRY_OTLP_ENDPOINT: endpoint,
        GEMINI_TELEMETRY_LOG_PROMPTS: "true",
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

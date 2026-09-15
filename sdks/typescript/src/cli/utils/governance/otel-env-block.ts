/**
 * Per-tool Path B (ingestion) OTel env block builder. Leaf module so the
 * three consumers - the mode resolver (wrapper-mode.ts), the persisted-
 * wiring refresh (telemetry-refresh.ts), and the logout scan
 * (telemetry-targets.ts) - can all derive the SAME key set and values
 * without import cycles. Install, refresh, and removal all read from
 * this one builder, so the surfaces can never drift apart.
 */

/** Ingestion source_type slug per wrapped tool (mint + cache key). */
export const SOURCE_TYPE_BY_TOOL: Record<string, string> = {
  claude: "claude_code",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  // `copilot_cli`, NOT `copilot` — `copilot_studio` (the Microsoft
  // Copilot Studio audit feed) already exists as a sourceType and a bare
  // `copilot` would be confusable with it in the API-keys page and
  // analytics filters. ADR-039 Decision 2.
  copilot: "copilot_cli",
  // `code` = the VS Code Copilot Chat extension. Its own sourceType so the
  // editor surface is separable from the CLI (`copilot_cli`) and app
  // (`copilot_app`) in the API-keys page and analytics. ADR-039 §Extension #2.
  code: "copilot_vscode",
};

/**
 * The same table read the other way, for callers that hold a source type and
 * need the tool slug the rest of the config is keyed by (`tool_project_keys`,
 * `tool_mode`, `tool_policies`). Derived, so the two can never disagree.
 */
export const TOOL_BY_SOURCE_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE_TYPE_BY_TOOL).map(([tool, sourceType]) => [sourceType, tool]),
);

/**
 * The env var names langwatch persists for `tool`'s Path B telemetry.
 * Derived from the same builder that installs them, so the logout /
 * removal path can strip exactly the keys the install path wrote (no
 * drift). Values are irrelevant here, so placeholders are passed in.
 */
export function telemetryEnvVarNames(tool: string): string[] {
  return Object.keys(buildOtelEnvBlock(tool, "", ""));
}

export function buildOtelEnvBlock(
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
      // Four OTel knobs (code.claude.com/docs/en/monitoring-usage), all ON:
      // TOOL_DETAILS/TOOL_CONTENT lift tool input/output onto tool events;
      // RAW_API_BODIES is the ONLY surface carrying assistant response
      // text, capped at 60KB inline by claude 2.x itself — extended-thinking
      // content is ALWAYS redacted from it regardless of flag state.
      // ENHANCED_TELEMETRY_BETA unlocks span-tracing (agent_id/
      // parent_agent_id); without it every sub-agent collapses into one
      // synthesized per-turn trace instead of a reconstructable tree.
      return {
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
        CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
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
      // gemini-cli's target only accepts local|gcp, NOT otlp (the doc string's
      // "example" is misleading — passing otlp throws FatalConfigError). We
      // reach our OTLP endpoint via `local` + `useCollector=true` instead.
      // `logPrompts=true` is what embeds actual prompt text in the
      // user_prompt event, without which there is nothing to lift onto
      // langwatch.input.value.
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
    case "copilot":
      // COPILOT_OTEL_EXPORTER_TYPE is pinned to "otlp-http" because an
      // inherited =file (from a prior ccusage setup) would silently redirect
      // all telemetry to a local JSONL file and Path B would capture nothing
      // (ADR-039 D5). CAPTURE_MESSAGE_CONTENT is the only surface carrying
      // prompt/response content. No OTEL_LOGS_EXPORTER: Copilot emits spans
      // + metrics only. grpc silently falls back, so http/json is pinned.
      return {
        COPILOT_OTEL_ENABLED: "true",
        COPILOT_OTEL_EXPORTER_TYPE: "otlp-http",
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=copilot-cli",
      };
    case "code":
      // VS Code Copilot Chat extension (ADR-039 §Extension #2). Same OTel
      // GenAI export as the copilot CLI, enabled purely by env — the
      // COPILOT_OTEL_ENABLED env overrides the extension's default-false
      // `github.copilot.chat.otel.enabled` setting (spike-verified: an
      // env-only launch with an empty settings.json still captured a real
      // turn). service.name=copilot-chat is the extension's own resource
      // label and the sourceType discriminator on the wire. Ingestion-only:
      // the chat extension has no BYOK gateway env, so no Path A here.
      return {
        COPILOT_OTEL_ENABLED: "true",
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=copilot-chat",
      };
    default:
      return base;
  }
}

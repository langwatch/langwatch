/**
 * Per-tool Path B (ingestion) OTel env block builder. Leaf module so the
 * mode resolver, persisted-wiring refresh and logout scan can all derive
 * the same key set and values without import cycles or drift.
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
 * The env var names langwatch persists for `tool`'s Path B telemetry,
 * derived from the same builder that installs them so removal strips
 * exactly what install wrote. Values are irrelevant; placeholders suffice.
 */
export function telemetryEnvVarNames(tool: string): string[] {
  return Object.keys(buildOtelEnvBlock(tool, "", ""));
}

/**
 * Env var names langwatch used to write for `tool`. Install only merges, so a dropped
 * key would linger in an existing block; refresh and logout strip these (#8284).
 */
export function legacyTelemetryEnvVarNames(tool: string): string[] {
  switch (tool) {
    case "claude":
      return ["OTEL_LOG_RAW_API_BODIES"];
    default:
      return [];
  }
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
      // ASSISTANT_RESPONSES carries the reply text; RAW_API_BODIES is opt-in because it
      // serialises the whole request and response on every call (#8284).
      // ENHANCED_TELEMETRY_BETA unlocks span-tracing into a reconstructable tree.
      return {
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
        CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
        OTEL_LOG_USER_PROMPTS: "1",
        OTEL_LOG_TOOL_DETAILS: "1",
        OTEL_LOG_TOOL_CONTENT: "1",
        OTEL_LOG_ASSISTANT_RESPONSES: "1",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=claude-code",
      };
    case "codex":
      return {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=codex",
      };
    case "gemini":
      // gemini-cli's target only accepts local|gcp, not otlp (its own doc
      // string's "example" is misleading -- otlp throws FatalConfigError).
      // We reach OTLP via `local` + `useCollector=true`; `logPrompts=true`
      // embeds prompt text.
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
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=opencode",
      };
    case "copilot":
      // COPILOT_OTEL_EXPORTER_TYPE is pinned "otlp-http": an inherited
      // =file (prior ccusage setup) would silently redirect telemetry to
      // JSONL (ADR-039 D5). No OTEL_LOGS_EXPORTER -- Copilot emits spans +
      // metrics only; grpc falls back silently, so http/protobuf is pinned.
      return {
        COPILOT_OTEL_ENABLED: "true",
        COPILOT_OTEL_EXPORTER_TYPE: "otlp-http",
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=copilot-cli",
      };
    case "code":
      // VS Code Copilot Chat extension (ADR-039 Extension #2).
      // COPILOT_OTEL_ENABLED overrides the extension's default-false
      // setting purely by env (verified: an empty settings.json still
      // captured a turn). Ingestion-only -- no BYOK gateway env, so no Path A.
      return {
        COPILOT_OTEL_ENABLED: "true",
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        ...base,
        OTEL_RESOURCE_ATTRIBUTES: "service.name=copilot-chat",
      };
    default:
      return base;
  }
}

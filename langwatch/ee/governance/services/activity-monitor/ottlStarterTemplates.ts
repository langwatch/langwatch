// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Canonical OTTL contract for IngestionSource cost extraction.
 *
 * Each ingestion source carries `parserConfig.ottlStatements: string[]`
 * — a list of OpenTelemetry Transformation Language statements that
 * map the upstream event's wire-specific attributes onto the
 * `langwatch.*` namespace. After transform, a single generic extractor
 * reads only `langwatch.*` keys, so adding a new tool (Codex, Gemini,
 * Copilot Studio, etc.) is a data-only PR — paste statements, ship.
 *
 * Statements run in `ottllog.TransformContext` (logs path) or
 * `ottlmetric.TransformContext` (metrics path) inside the aigateway
 * Go service. The TS control plane never evaluates OTTL itself; it
 * proxies validation + transform requests to the gateway.
 *
 * Spec: specs/ai-governance/ingestion-sources/claude-code-otlp.feature
 */

/**
 * The post-transform reader walks LogRecord attributes for these keys.
 * Resource attributes are merged into the per-record bag by the
 * receiver before extraction, so statements that target
 * `resource.attributes["..."]` flow through the same merge path.
 */
export const LANGWATCH_OTTL_FIELDS = {
  COST_USD: "langwatch.cost.usd",
  REQUEST_ID: "langwatch.request_id",
  MODEL: "langwatch.model",
  INPUT_TOKENS: "langwatch.input_tokens",
  OUTPUT_TOKENS: "langwatch.output_tokens",
  CACHE_READ_TOKENS: "langwatch.cache_read_tokens",
  CACHE_CREATION_TOKENS: "langwatch.cache_creation_tokens",
  PRINCIPAL_EMAIL: "langwatch.principal.email",
  TEAM_ID_HINT: "langwatch.team.id_hint",
} as const;

export type LangwatchOttlField =
  (typeof LANGWATCH_OTTL_FIELDS)[keyof typeof LANGWATCH_OTTL_FIELDS];

/**
 * Claude Code 2.1+ OTLP wire shape — captured from the official
 * exporter (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_LOGS_EXPORTER=otlp`).
 * Each cost-bearing API call is one `claude_code.api_request` LogRecord
 * with the per-request fields directly on `attributes[]`. Resource
 * attributes (when the operator sets `OTEL_RESOURCE_ATTRIBUTES=team.id=…`)
 * carry the team hint.
 *
 * The `where` clause targets `attributes["event.name"] == "api_request"`
 * (the exporter writes the suffix); the legacy extractor also accepts
 * `body.stringValue == "claude_code.api_request"`, but OTTL's body
 * shape is signal-specific and the attribute form is portable across
 * SDK versions.
 */
export const CLAUDE_CODE_OTTL_STARTER: readonly string[] = [
  `set(attributes["langwatch.cost.usd"], attributes["cost_usd"]) where attributes["event.name"] == "api_request"`,
  `set(attributes["langwatch.request_id"], attributes["request_id"]) where attributes["event.name"] == "api_request"`,
  `set(attributes["langwatch.model"], attributes["model"]) where attributes["event.name"] == "api_request"`,
  `set(attributes["langwatch.input_tokens"], attributes["input_tokens"]) where attributes["event.name"] == "api_request"`,
  `set(attributes["langwatch.output_tokens"], attributes["output_tokens"]) where attributes["event.name"] == "api_request"`,
  `set(attributes["langwatch.cache_read_tokens"], attributes["cache_read_tokens"]) where attributes["event.name"] == "api_request"`,
  `set(attributes["langwatch.cache_creation_tokens"], attributes["cache_creation_tokens"]) where attributes["event.name"] == "api_request"`,
  `set(attributes["langwatch.principal.email"], attributes["user.email"]) where attributes["event.name"] == "api_request"`,
  `set(attributes["langwatch.team.id_hint"], resource.attributes["team.id"]) where attributes["event.name"] == "api_request"`,
] as const;

/**
 * Source-type → starter statements. Push-mode source types that ship
 * with a known wire shape get a starter; otel_generic stays blank so
 * admins paste their own without a misleading default. Future tools
 * (codex, gemini, copilot_studio) ship as data-only additions here.
 */
export const OTTL_STARTER_BY_SOURCE_TYPE: Record<string, readonly string[]> = {
  claude_code: CLAUDE_CODE_OTTL_STARTER,
  otel_generic: [],
};

/**
 * Source types where the OTTL editor renders in the composer / drawer.
 * Pull-mode sources (workato, copilot_studio, openai_compliance, …)
 * use adapter-specific config and don't accept OTTL statements in v1.
 */
export const OTTL_ENABLED_SOURCE_TYPES: readonly string[] = [
  "claude_code",
  "otel_generic",
];

export function getStarterTemplate(sourceType: string): readonly string[] {
  return OTTL_STARTER_BY_SOURCE_TYPE[sourceType] ?? [];
}

export function isOttlEnabledSourceType(sourceType: string): boolean {
  return OTTL_ENABLED_SOURCE_TYPES.includes(sourceType);
}

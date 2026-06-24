/**
 * Per-destination column references for ES field paths the ADR-034 router
 * cares about (Phase 3 app-layer module).
 *
 * Carries ONLY the field mappings whose `availableOn.rollup` or
 * `availableOn.slim` is set — these are the metrics + dim columns the new
 * slim/rollup tables can serve. Everything else stays driven off the legacy
 * `~/server/analytics/clickhouse/field-mappings.ts` (untouched by this
 * rewrite); the legacy SQL builder targets `trace_summaries` and doesn't need
 * this metadata.
 *
 * Used by the routing module + the slim/rollup query-builders to know which
 * column to read on each table without re-hardcoding the names twice. When
 * routing decides "this query is rollable", it consults this table to find
 * `rollup.column` for each metric and emits `sum(<column>)`.
 */

/** Reference into one of the two new analytics tables. */
export interface FieldAvailability {
  /** Reference into `trace_analytics_rollup` (Phase 1). */
  rollup?: { column: string };
  /** Reference into the slim `trace_analytics` (Phase 2). */
  slim?: { column?: string; attributeKey?: string };
  /** Reference into the legacy `trace_summaries` table (always present). */
  traceSummaries: { column: string };
}

/**
 * ES field path → per-destination availability. Mirrors the entries previously
 * carried on `fieldMappings[*].availableOn` in the legacy field-mappings
 * module — extracted here so the router/builders own the destination knowledge,
 * and the legacy `field-mappings.ts` keeps its single responsibility
 * (ES↔CH translation for the trace_summaries SQL builder).
 */
export const FIELD_AVAILABILITY: Readonly<Record<string, FieldAvailability>> = {
  trace_name: {
    slim: { column: "TraceName" },
    traceSummaries: { column: "TraceName" },
  },
  "metadata.user_id": {
    slim: { column: "UserId" },
    traceSummaries: { column: "Attributes['langwatch.user_id']" },
  },
  "metadata.thread_id": {
    slim: { column: "ConversationId" },
    traceSummaries: { column: "Attributes['gen_ai.conversation.id']" },
  },
  "metadata.customer_id": {
    slim: { column: "CustomerId" },
    traceSummaries: { column: "Attributes['langwatch.customer_id']" },
  },
  "metadata.labels": {
    // Slim hoists labels into Array(String); no JSON parse required.
    slim: { column: "Labels" },
    traceSummaries: { column: "Attributes['langwatch.labels']" },
  },
  "metadata.topic_id": {
    slim: { column: "TopicId" },
    traceSummaries: { column: "TopicId" },
  },
  "metadata.subtopic_id": {
    slim: { column: "SubTopicId" },
    traceSummaries: { column: "SubTopicId" },
  },
  "metrics.total_time_ms": {
    rollup: { column: "DurationSum" },
    slim: { column: "TotalDurationMs" },
    traceSummaries: { column: "TotalDurationMs" },
  },
  "metrics.first_token_ms": {
    // Rollup does NOT carry FirstTokenSum — TTFT is resolved at fold-time
    // across the trace's spans, not reliable per-span (see migration 00035).
    slim: { column: "TimeToFirstTokenMs" },
    traceSummaries: { column: "TimeToFirstTokenMs" },
  },
  "metrics.total_cost": {
    rollup: { column: "CostSum" },
    slim: { column: "TotalCost" },
    traceSummaries: { column: "TotalCost" },
  },
  "metrics.prompt_tokens": {
    rollup: { column: "PromptTokensSum" },
    slim: { column: "PromptTokens" },
    traceSummaries: { column: "TotalPromptTokenCount" },
  },
  "metrics.completion_tokens": {
    rollup: { column: "CompletionTokensSum" },
    slim: { column: "CompletionTokens" },
    traceSummaries: { column: "TotalCompletionTokenCount" },
  },
  tokens_per_second: {
    slim: { column: "TokensPerSecond" },
    traceSummaries: { column: "TokensPerSecond" },
  },
  "error.has_error": {
    slim: { column: "HasError" },
    traceSummaries: { column: "ContainsErrorStatus" },
  },
  models: {
    // Rollup keys on per-span `Model`; slim has `Models` (Array(String))
    rollup: { column: "Model" },
    slim: { column: "Models" },
    traceSummaries: { column: "Models" },
  },
};

/** Look up the per-destination column references for an ES field path. */
export function getFieldAvailability(
  esField: string,
): FieldAvailability | undefined {
  return FIELD_AVAILABILITY[esField];
}

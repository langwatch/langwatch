/**
 * Per-destination column references for ES field paths the ADR-034 router
 * cares about (Phase 3 app-layer module, extended in Phase 6 for the eval
 * pipeline).
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
 *
 * Source-awareness (Phase 6): each entry declares the upstream pipeline its
 * fast-path columns belong to (`trace` | `evaluation`). The router consults
 * `source` to:
 *   - pick the right slim/rollup TABLE (`evaluation_analytics_*` vs
 *     `trace_analytics_*`) so a trace-source metric never routes onto an
 *     eval table and vice-versa;
 *   - pick the right LEGACY-FALLBACK table (`evaluation_runs` vs
 *     `trace_summaries`);
 *   - source-group candidate triggers in the heartbeat so at most one CH
 *     query per (project, source) per tick.
 */

/** The upstream pipeline whose fold a metric reads from. */
export type AnalyticsMetricSource = "trace" | "evaluation";

/** Reference into one of the analytics tables. */
export interface FieldAvailability {
  /** Reference into `<source>_analytics_rollup`. */
  rollup?: { column: string };
  /** Reference into the slim `<source>_analytics`. */
  slim?: { column?: string; attributeKey?: string };
  /** Reference into the legacy table (`trace_summaries` or `evaluation_runs`). */
  legacy: { column: string };
  /** Which upstream pipeline owns the fast-path columns for this metric. */
  source: AnalyticsMetricSource;
}

/**
 * ES field path → per-destination availability. Mirrors the entries previously
 * carried on `fieldMappings[*].availableOn` in the legacy field-mappings
 * module — extracted here so the router/builders own the destination knowledge,
 * and the legacy `field-mappings.ts` keeps its single responsibility
 * (ES↔CH translation for the trace_summaries SQL builder).
 *
 * Trace-source entries: read from / route to trace_analytics / trace_analytics_rollup,
 * fall back to trace_summaries.
 * Evaluation-source entries: read from / route to evaluation_analytics /
 * evaluation_analytics_rollup, fall back to evaluation_runs.
 */
export const FIELD_AVAILABILITY: Readonly<Record<string, FieldAvailability>> = {
  // ── Trace-source dim fields ─────────────────────────────────────────
  trace_name: {
    slim: { column: "TraceName" },
    legacy: { column: "TraceName" },
    source: "trace",
  },
  "metadata.user_id": {
    slim: { column: "UserId" },
    legacy: { column: "Attributes['langwatch.user_id']" },
    source: "trace",
  },
  "metadata.thread_id": {
    slim: { column: "ConversationId" },
    legacy: { column: "Attributes['gen_ai.conversation.id']" },
    source: "trace",
  },
  "metadata.customer_id": {
    slim: { column: "CustomerId" },
    legacy: { column: "Attributes['langwatch.customer_id']" },
    source: "trace",
  },
  "metadata.labels": {
    // Slim hoists labels into Array(String); no JSON parse required.
    slim: { column: "Labels" },
    legacy: { column: "Attributes['langwatch.labels']" },
    source: "trace",
  },
  "metadata.topic_id": {
    slim: { column: "TopicId" },
    legacy: { column: "TopicId" },
    source: "trace",
  },
  "metadata.subtopic_id": {
    slim: { column: "SubTopicId" },
    legacy: { column: "SubTopicId" },
    source: "trace",
  },
  "metrics.total_time_ms": {
    rollup: { column: "DurationSum" },
    slim: { column: "TotalDurationMs" },
    legacy: { column: "TotalDurationMs" },
    source: "trace",
  },
  "metrics.first_token_ms": {
    // Rollup does NOT carry FirstTokenSum — TTFT is resolved at fold-time
    // across the trace's spans, not reliable per-span (see migration 00035).
    slim: { column: "TimeToFirstTokenMs" },
    legacy: { column: "TimeToFirstTokenMs" },
    source: "trace",
  },
  "metrics.total_cost": {
    rollup: { column: "CostSum" },
    slim: { column: "TotalCost" },
    legacy: { column: "TotalCost" },
    source: "trace",
  },
  "metrics.prompt_tokens": {
    rollup: { column: "PromptTokensSum" },
    slim: { column: "PromptTokens" },
    legacy: { column: "TotalPromptTokenCount" },
    source: "trace",
  },
  "metrics.completion_tokens": {
    rollup: { column: "CompletionTokensSum" },
    slim: { column: "CompletionTokens" },
    legacy: { column: "TotalCompletionTokenCount" },
    source: "trace",
  },
  tokens_per_second: {
    slim: { column: "TokensPerSecond" },
    legacy: { column: "TokensPerSecond" },
    source: "trace",
  },
  "error.has_error": {
    slim: { column: "HasError" },
    legacy: { column: "ContainsErrorStatus" },
    source: "trace",
  },
  models: {
    // Rollup keys on per-span `Model`; slim has `Models` (Array(String))
    rollup: { column: "Model" },
    slim: { column: "Models" },
    legacy: { column: "Models" },
    source: "trace",
  },

  // ── Evaluation-source metric fields (ADR-034 Phase 6) ───────────────
  // The registry keys are `evaluations.evaluation_score` /
  // `evaluations.evaluation_pass_rate` / `evaluations.evaluation_runs` —
  // see `~/server/analytics/registry.ts`. Each maps to one column on the
  // eval rollup and one column on the slim eval table; legacy fallback is
  // `evaluation_runs` (the pre-rewrite per-eval ReplacingMergeTree).
  "evaluations.evaluation_score": {
    // Rollup carries (ScoreSum, ScoreCount); the SQL builder picks the
    // right pair for sum/avg. Single-column reference here points at the
    // numerator; the builder knows to also pull the count.
    rollup: { column: "ScoreSum" },
    slim: { column: "Score" },
    legacy: { column: "Score" },
    source: "evaluation",
  },
  "evaluations.evaluation_pass_rate": {
    // Pass-rate on the rollup is sum(PassCount) / nullIf(sum(PassCount) +
    // sum(FailCount), 0). The builder reads both columns; this entry's
    // `column` points at the numerator (PassCount) and the builder uses
    // an additional convention to fetch FailCount as the denominator.
    rollup: { column: "PassCount" },
    slim: { column: "Passed" },
    legacy: { column: "Passed" },
    source: "evaluation",
  },
  "evaluations.evaluation_runs": {
    // Eval count is just EvalCount on the rollup, count() on the slim, and
    // uniq(EvaluationId) on the legacy table. The builder maps the
    // metric's `aggregation: "cardinality"` to the right shape per table.
    rollup: { column: "EvalCount" },
    slim: { column: "EvaluationId" },
    legacy: { column: "EvaluationId" },
    source: "evaluation",
  },

  // Optional eval-domain hoisted dims (for grouping / filtering).
  "evaluations.evaluator_type": {
    rollup: { column: "EvaluatorType" },
    slim: { column: "EvaluatorType" },
    legacy: { column: "EvaluatorType" },
    source: "evaluation",
  },
  "evaluations.evaluation_passed": {
    slim: { column: "Passed" },
    legacy: { column: "Passed" },
    source: "evaluation",
  },
  "evaluations.evaluation_label": {
    slim: { column: "Label" },
    legacy: { column: "Label" },
    source: "evaluation",
  },
  "evaluations.evaluation_status": {
    rollup: { column: "Status" },
    slim: { column: "Status" },
    legacy: { column: "Status" },
    source: "evaluation",
  },
};

/** Look up the per-destination column references for an ES field path. */
export function getFieldAvailability(
  esField: string,
): FieldAvailability | undefined {
  return FIELD_AVAILABILITY[esField];
}

/**
 * Source of a registry metric key (e.g. `"performance.total_cost"` →
 * `"trace"`, `"evaluations.evaluation_score"` → `"evaluation"`).
 *
 * Resolution order:
 *   1. Direct hit on `FIELD_AVAILABILITY` (per-ES-field entries above).
 *   2. Prefix heuristic on the registry group — `performance.*` /
 *      `metadata.*` / `topics.*` / `traces.*` / `models` are trace-domain;
 *      `evaluations.*` is eval-domain. The fast-path mappings above are
 *      keyed on ES field paths (e.g. `metrics.total_time_ms`), not on
 *      registry keys (e.g. `performance.completion_time`); the prefix
 *      heuristic gives the router source-awareness for the common
 *      registry keys without forcing every entry to be doubly declared.
 *
 * Returns `undefined` when the metric belongs to a group with no fast-path
 * mapping — the router treats those as legacy-only.
 */
export function getMetricSource(
  metricKey: string,
): AnalyticsMetricSource | undefined {
  const direct = FIELD_AVAILABILITY[metricKey]?.source;
  if (direct) return direct;
  // Registry-group prefix heuristic. Mirrors the legacy field-mappings'
  // group classification — every metric in these groups reads off the
  // trace pipeline today; every metric in `evaluations.*` reads off the
  // eval pipeline.
  if (
    metricKey.startsWith("performance.") ||
    metricKey.startsWith("metadata.") ||
    metricKey.startsWith("topics.") ||
    metricKey.startsWith("traces.") ||
    metricKey === "models" ||
    metricKey === "trace_name"
  ) {
    return "trace";
  }
  if (metricKey.startsWith("evaluations.")) {
    return "evaluation";
  }
  return undefined;
}

/**
 * Analytics table routing — ADR-034 Phase 3 (app-layer module), extended in
 * Phase 6 to cover the eval pipeline.
 *
 * Picks ONE of five ClickHouse tables to serve a `getTimeseries` query:
 *
 *   TRACE-source paths:
 *   - `trace_analytics_rollup` — additive `SimpleAggregateFunction(sum, …)`
 *     bucketed by `(TenantId, BucketStart, Model, SpanType)` (migration 00037).
 *     Cheap, but only ever serves additive sums/avgs/mins/maxes on metrics that
 *     live as a column on the rollup AND group-by ∈ {none, Model, SpanType} AND
 *     no filters on dimensions the rollup is not keyed by.
 *
 *   - `trace_analytics` — slim `ReplacingMergeTree(UpdatedAt)`, one row per
 *     trace, hoisted dim columns + a heuristically-trimmed `Attributes` map
 *     (migration 00038). Serves percentiles, late/rich-dim group-bys,
 *     hoisted-column filters, metadata.* / langwatch.reserved.* attribute reads,
 *     arbitrary attribute keys whose values are known to fit ≤ 256 chars.
 *
 *   - `trace_summaries` — legacy fallback, UNCHANGED.
 *
 *   EVAL-source paths (Phase 6):
 *   - `evaluation_analytics_rollup` — additive `SimpleAggregateFunction(sum, …)`
 *     bucketed by `(TenantId, BucketStart, EvaluatorType, Status)` (00038).
 *   - `evaluation_analytics` — slim `ReplacingMergeTree(UpdatedAt)`, one row
 *     per evaluation, hoisted dim columns + trimmed Attributes (00039).
 *   - `evaluation_runs` — legacy fallback for the eval pipeline, the
 *     pre-rewrite per-evaluation ReplacingMergeTree.
 *
 * Defaults: **on any doubt, return the source's legacy fallback table**
 * (`trace_summaries` for trace-source metrics; `evaluation_runs` for
 * eval-source metrics). Slim/rollup are opt-in optimisations.
 *
 * The function is the SINGLE place where the routing decision lives — the
 * downstream query-builders consume the chosen table, they do not re-derive
 * it.
 */

import {
  PAYLOAD_BLOCKLIST_EXACT,
  PAYLOAD_BLOCKLIST_PREFIXES,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/analytics-attribute-trim.service";
import type { SeriesInputType } from "~/server/analytics/registry";
import type { AggregationTypes } from "~/server/analytics/types";
import type { FilterField } from "~/server/filters/types";
import {
  type AnalyticsMetricSource,
  getMetricSource,
} from "./field-availability";

/** The five destination tables routed between. */
export type AnalyticsTable =
  | "trace_analytics_rollup"
  | "trace_analytics"
  | "trace_summaries"
  | "evaluation_analytics_rollup"
  | "evaluation_analytics"
  | "evaluation_runs";

/** Legacy fallback table for each metric source. */
function legacyFallbackFor(source: AnalyticsMetricSource): AnalyticsTable {
  switch (source) {
    case "trace":
      return "trace_summaries";
    case "evaluation":
      return "evaluation_runs";
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled metric source: ${String(_exhaustive)}`);
    }
  }
}

/** Rollup destination for each metric source. */
function rollupTableFor(source: AnalyticsMetricSource): AnalyticsTable {
  switch (source) {
    case "trace":
      return "trace_analytics_rollup";
    case "evaluation":
      return "evaluation_analytics_rollup";
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled metric source: ${String(_exhaustive)}`);
    }
  }
}

/** Slim destination for each metric source. */
function slimTableFor(source: AnalyticsMetricSource): AnalyticsTable {
  switch (source) {
    case "trace":
      return "trace_analytics";
    case "evaluation":
      return "evaluation_analytics";
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled metric source: ${String(_exhaustive)}`);
    }
  }
}

// ─── Trace-source rollup eligibility ─────────────────────────────────

/**
 * Registry metric keys ("<group>.<metric>") that can be served from
 * `trace_analytics_rollup` for additive aggregations. Derived directly from
 * the rollup column set (migration 00037 — see
 * `trace_analytics_rollup.mapProjection.ts`):
 *
 * Distinct trace counts (TraceUniq) are NOT in the rollup; the slim path
 * handles `metadata.trace_id` cardinality.
 */
const ROLLUP_ROLLABLE_TRACE_METRIC_KEYS_LIST = [
  "performance.total_cost",
  "performance.cost_billed",
  "performance.cost_non_billed",
  "performance.completion_time",
  "performance.prompt_tokens",
  "performance.completion_tokens",
  "performance.cache_read_tokens",
  "performance.cache_write_tokens",
  "performance.reasoning_tokens",
  "performance.total_tokens",
  "performance.total_processed_tokens",
] as const;
export type TraceRollupMetricKey =
  (typeof ROLLUP_ROLLABLE_TRACE_METRIC_KEYS_LIST)[number];

/**
 * Registry metric keys that can be served from `evaluation_analytics_rollup`
 * for additive aggregations. The rollup carries pass/fail/error/skipped
 * counters, a score sum + count pair (for true avg), and total eval count;
 * see migration 00039 + `evaluationAnalyticsRollup.mapProjection.ts`.
 *
 * `evaluations.evaluation_runs` rolls up to `EvalCount` (additive sum) —
 * the registry's `cardinality` aggregation maps to `sum(EvalCount)`. Score
 * uses `sum(ScoreSum) / nullIf(sum(ScoreCount), 0)` for `avg`. Pass rate
 * uses `sum(PassCount) / nullIf(sum(PassCount) + sum(FailCount), 0)`.
 */
const ROLLUP_ROLLABLE_EVAL_METRIC_KEYS_LIST = [
  "evaluations.evaluation_score",
  "evaluations.evaluation_pass_rate",
  "evaluations.evaluation_runs",
] as const;
export type EvalRollupMetricKey =
  (typeof ROLLUP_ROLLABLE_EVAL_METRIC_KEYS_LIST)[number];

/** Backwards-compatible union — all rollup-rollable metric keys, any source. */
export type RollupRollableMetricKey =
  | TraceRollupMetricKey
  | EvalRollupMetricKey;

export const ROLLUP_ROLLABLE_METRIC_KEYS: ReadonlySet<string> = new Set<string>([
  ...ROLLUP_ROLLABLE_TRACE_METRIC_KEYS_LIST,
  ...ROLLUP_ROLLABLE_EVAL_METRIC_KEYS_LIST,
]);

export function isRollupRollableMetricKey(
  metric: string,
): metric is RollupRollableMetricKey {
  return ROLLUP_ROLLABLE_METRIC_KEYS.has(metric);
}

const ROLLUP_ROLLABLE_TRACE_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  ROLLUP_ROLLABLE_TRACE_METRIC_KEYS_LIST,
);
const ROLLUP_ROLLABLE_EVAL_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  ROLLUP_ROLLABLE_EVAL_METRIC_KEYS_LIST,
);

// ─── Slim eligibility ────────────────────────────────────────────────

/**
 * Registry metric keys that can be served from the slim `trace_analytics`
 * table. These have a typed column or are an attribute read off the trimmed
 * Attributes map.
 */
const SLIM_ELIGIBLE_TRACE_METRIC_KEYS_LIST = [
  "metadata.trace_id",
  "metadata.user_id",
  "metadata.thread_id",
  "performance.total_cost",
  "performance.cost_billed",
  "performance.cost_non_billed",
  "performance.completion_time",
  "performance.first_token",
  "performance.prompt_tokens",
  "performance.completion_tokens",
  "performance.cache_read_tokens",
  "performance.cache_write_tokens",
  "performance.reasoning_tokens",
  "performance.total_tokens",
  "performance.total_processed_tokens",
  "performance.tokens_per_second",
] as const;
export type SlimTraceMetricKey =
  (typeof SLIM_ELIGIBLE_TRACE_METRIC_KEYS_LIST)[number];

/**
 * Registry metric keys that can be served from the slim
 * `evaluation_analytics` table. Each has a typed column on the slim row;
 * see migration 00040 + `evaluationAnalytics.foldProjection.ts`.
 */
const SLIM_ELIGIBLE_EVAL_METRIC_KEYS_LIST = [
  "evaluations.evaluation_score",
  "evaluations.evaluation_pass_rate",
  "evaluations.evaluation_runs",
] as const;
export type SlimEvalMetricKey =
  (typeof SLIM_ELIGIBLE_EVAL_METRIC_KEYS_LIST)[number];

export type SlimEligibleMetricKey = SlimTraceMetricKey | SlimEvalMetricKey;

export const SLIM_ELIGIBLE_METRIC_KEYS: ReadonlySet<string> = new Set<string>([
  ...SLIM_ELIGIBLE_TRACE_METRIC_KEYS_LIST,
  ...SLIM_ELIGIBLE_EVAL_METRIC_KEYS_LIST,
]);

export function isSlimEligibleMetricKey(
  metric: string,
): metric is SlimEligibleMetricKey {
  return SLIM_ELIGIBLE_METRIC_KEYS.has(metric);
}

const SLIM_ELIGIBLE_TRACE_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  SLIM_ELIGIBLE_TRACE_METRIC_KEYS_LIST,
);
const SLIM_ELIGIBLE_EVAL_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  SLIM_ELIGIBLE_EVAL_METRIC_KEYS_LIST,
);

// ─── Group-by eligibility ────────────────────────────────────────────

/**
 * Trace-rollup group-by keys — {none, Model, SpanType}.
 */
const ROLLUP_TRACE_GROUP_BY_KEYS: ReadonlySet<string> = new Set([
  "metadata.model",
  "metadata.span_type",
]);

/**
 * Eval-rollup group-by keys — the dims final at evaluation-completion time
 * AND on the rollup's keying tuple (see migration 00039):
 *   {none, EvaluatorType, Status}.
 */
const ROLLUP_EVAL_GROUP_BY_KEYS: ReadonlySet<string> = new Set([
  "evaluations.evaluator_type",
  "evaluations.evaluation_status",
]);

/**
 * Group-by keys the slim trace table carries (typed columns + Attributes reads).
 *
 * `metadata.model` is DELIBERATELY EXCLUDED — see the trace slim builder's
 * doc for the per-trace dedup'd `Models` array vs per-span rollup `Model`
 * semantic-mismatch reasoning.
 *
 * `metadata.span_type` requires a stored_spans join (not on slim).
 */
const SLIM_TRACE_GROUP_BY_KEYS: ReadonlySet<string> = new Set([
  "topics.topics",
  "traces.trace_name",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
]);

/**
 * Group-by keys the slim eval table carries. The slim row hoists
 * EvaluatorType / EvaluatorName / Status / Passed / Label / Model /
 * TraceId as typed root columns.
 */
const SLIM_EVAL_GROUP_BY_KEYS: ReadonlySet<string> = new Set([
  "evaluations.evaluator_type",
  "evaluations.evaluation_passed",
  "evaluations.evaluation_label",
  "evaluations.evaluation_status",
]);

// ─── Filter eligibility ──────────────────────────────────────────────

/** Trace-rollup filter fields (none — anything filterable forces slim). */
const ROLLUP_TRACE_FILTER_FIELDS: ReadonlySet<FilterField> =
  new Set<FilterField>();

/** Eval-rollup filter fields — fields on the rollup's keying tuple. */
const ROLLUP_EVAL_FILTER_FIELDS: ReadonlySet<FilterField> =
  new Set<FilterField>();

/** Slim-trace filter fields (typed columns + trimmed Attributes reads). */
const SLIM_TRACE_FILTER_FIELDS: ReadonlySet<FilterField> = new Set<FilterField>(
  [
    "topics.topics",
    "topics.subtopics",
    "metadata.user_id",
    "metadata.thread_id",
    "metadata.customer_id",
    "metadata.labels",
    "metadata.key",
    "metadata.value",
    "metadata.prompt_ids",
    "traces.origin",
    "traces.error",
    "traces.name",
  ],
);

/** Slim-eval filter fields — typed columns on the slim row. */
const SLIM_EVAL_FILTER_FIELDS: ReadonlySet<FilterField> = new Set<FilterField>(
  [
    "metadata.key",
    "metadata.value",
  ],
);

/**
 * Aggregations the trace rollup can compute CORRECTLY from its columns. The
 * rollup carries `SimpleAggregateFunction(sum, …)` columns only — one summed
 * value per (bucket, model, span_type). Only `sum` is well-defined:
 *
 *   - `sum(col)`     → the additive total. Correct.
 *   - `avg(col)`     → mean of per-bucket SUMS, not the per-trace mean the
 *                      legacy path returns (no count column to divide by). Wrong.
 *   - `min/max(col)` → min/max of per-bucket sums, which also changes value
 *                      across background merges. Non-deterministic + wrong.
 *
 * So avg/min/max are DELIBERATELY excluded — they fall through to the slim
 * table, whose one-row-per-trace shape computes them correctly per trace
 * (trace5012-P0).
 */
const ROLLUP_TRACE_AGGREGATIONS: ReadonlySet<AggregationTypes> =
  new Set<AggregationTypes>(["sum"]);

/**
 * Aggregations the eval rollup can compute CORRECTLY. `avg` is safe because
 * the eval rollup carries the (ScoreSum, ScoreCount) pair, so the builder
 * computes a true weighted mean `sum(ScoreSum)/nullIf(sum(ScoreCount),0)`
 * rather than an average-of-averages. `cardinality` is additive (every
 * terminal eval contributes EvalCount = 1; distinct eval-id count is
 * `sum(EvalCount)`).
 *
 * `min`/`max` are DELIBERATELY excluded: the builder computes them as
 * `min/max(ScoreSum / ScoreCount)` per rollup ROW, i.e. the min/max of
 * per-bucket AVERAGES — merge-state-dependent and not the true worst/best
 * score. They fall through to the eval slim table, one row per evaluation,
 * where `min/max(Score)` is the real per-eval extremum (eval5014-P1).
 */
const ROLLUP_EVAL_AGGREGATIONS: ReadonlySet<AggregationTypes> =
  new Set<AggregationTypes>(["sum", "avg", "cardinality"]);

/**
 * Input shape for the routing decision. Mirrors the relevant subset of
 * `TimeseriesInputType` — kept tight so the function stays trivially testable.
 */
export interface PickAnalyticsTableInput {
  series: SeriesInputType[];
  filters?: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >;
  groupBy?: string;
}

/**
 * Decide which ClickHouse table should serve a `getTimeseries` query.
 *
 * Source-aware (ADR-034 Phase 6): a query's metric source is determined by
 * the first series' metric key. ALL series in a query must share the same
 * source — if they don't, we fall back to the trace legacy table
 * (`trace_summaries`) because the legacy SQL builder can mix trace + eval
 * reads via its existing JOIN path, and that's the safe default.
 *
 * Order of evaluation per source (any failure cascades to the source's
 * legacy fallback):
 *   1. Try the source's rollup — strictest, fastest.
 *   2. Try the source's slim.
 *   3. Otherwise the source's legacy fallback.
 */
export function pickAnalyticsTable(
  input: PickAnalyticsTableInput,
): AnalyticsTable {
  // Empty series → can't route confidently; fall back to the broad legacy.
  if (!input.series || input.series.length === 0) return "trace_summaries";

  // Determine the source. All series must agree.
  const sources = new Set<AnalyticsMetricSource | undefined>();
  for (const s of input.series) {
    sources.add(getMetricSource(s.metric));
  }
  // Mixed source or unknown → conservative fallback to the legacy trace
  // table; the legacy builder is the only path that can mix trace + eval
  // reads (and unknown-source metrics route through it today).
  if (sources.size !== 1) return "trace_summaries";
  const source = Array.from(sources)[0];
  if (source === undefined) return "trace_summaries";

  // Pipeline (per-user/per-thread/per-customer) aggregations require
  // trace-level dim values that change after the spans land — those reads
  // only make sense against the slim table (per-trace) or the legacy
  // fallback. Never the rollup.
  const hasPipeline = input.series.some((s) => s.pipeline !== undefined);

  // Series-level filters complicate the routing — bail out conservatively
  // to the source's legacy when any series carries its own filter set,
  // because per-series filters can read fields neither slim nor rollup
  // carries.
  const hasSeriesFilters = input.series.some(
    (s) => s.filters !== undefined && Object.keys(s.filters).length > 0,
  );
  if (hasSeriesFilters) return legacyFallbackFor(source);

  // Reject anything reading a blocklisted attribute key via metadata.key /
  // metadata.value — those values were dropped from slim's trimmed
  // Attributes map and only survive on the legacy table.
  if (filtersHitBlocklist(input.filters)) return legacyFallbackFor(source);

  // ---------- Rollup eligibility ----------
  const rollupOk =
    !hasPipeline &&
    rollupHandlesAllSeries(input.series, source) &&
    rollupHandlesGroupBy(input.groupBy, source) &&
    rollupHandlesFilters(input.filters, source);
  if (rollupOk) return rollupTableFor(source);

  // ---------- Slim eligibility ----------
  const slimOk =
    slimHandlesAllSeries(input.series, source) &&
    slimHandlesGroupBy(input.groupBy, source) &&
    slimHandlesFilters(input.filters, source);
  if (slimOk) return slimTableFor(source);

  // ---------- Default safe fallback ----------
  return legacyFallbackFor(source);
}

// ---------------------------------------------------------------------------
// Rollup predicates
// ---------------------------------------------------------------------------

function rollupHandlesAllSeries(
  series: SeriesInputType[],
  source: AnalyticsMetricSource,
): boolean {
  return series.every((s) => rollupHandlesSeries(s, source));
}

function rollupHandlesSeries(
  s: SeriesInputType,
  source: AnalyticsMetricSource,
): boolean {
  const allowedAggs =
    source === "trace"
      ? ROLLUP_TRACE_AGGREGATIONS
      : ROLLUP_EVAL_AGGREGATIONS;
  if (!allowedAggs.has(s.aggregation)) return false;
  if (s.key !== undefined || s.subkey !== undefined) {
    // `requiresKey` metrics in the eval domain (every entry in
    // `evaluations.*`) carry a key — they STILL route to the rollup as long
    // as the key is a single evaluator-id filter the rollup's EvaluatorType
    // column can serve via WHERE. We accept `key` for eval-source metrics
    // only; trace-source rollup metrics reject `key` (none of them
    // requireKey today).
    if (source !== "evaluation") return false;
  }
  const keys =
    source === "trace"
      ? ROLLUP_ROLLABLE_TRACE_METRIC_KEYS
      : ROLLUP_ROLLABLE_EVAL_METRIC_KEYS;
  return keys.has(s.metric);
}

function rollupHandlesGroupBy(
  groupBy: string | undefined,
  source: AnalyticsMetricSource,
): boolean {
  if (!groupBy) return true;
  const keys =
    source === "trace"
      ? ROLLUP_TRACE_GROUP_BY_KEYS
      : ROLLUP_EVAL_GROUP_BY_KEYS;
  return keys.has(groupBy);
}

function rollupHandlesFilters(
  filters: PickAnalyticsTableInput["filters"],
  source: AnalyticsMetricSource,
): boolean {
  if (!filters) return true;
  const allowed =
    source === "trace" ? ROLLUP_TRACE_FILTER_FIELDS : ROLLUP_EVAL_FILTER_FIELDS;
  for (const [field, value] of Object.entries(filters)) {
    if (!hasAnyFilterValue(value)) continue;
    if (!allowed.has(field as FilterField)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Slim predicates
// ---------------------------------------------------------------------------

function slimHandlesAllSeries(
  series: SeriesInputType[],
  source: AnalyticsMetricSource,
): boolean {
  return series.every((s) => slimHandlesSeries(s, source));
}

function slimHandlesSeries(
  s: SeriesInputType,
  source: AnalyticsMetricSource,
): boolean {
  // group by a dim then re-aggregate the groups. The slim builder does NOT
  // implement the outer re-aggregation — it only ever emits the flat inner
  // aggregation, silently returning e.g. the total distinct trace count for
  // an "average traces per user" query (trace5012-P0). Until the slim builder
  // grows real pipeline support, route ALL pipeline series to the legacy
  // fallback, which computes the two-level aggregation correctly.
  if (s.pipeline) return false;
  if (s.key !== undefined || s.subkey !== undefined) {
    // Same eval-domain `requiresKey` allowance as the rollup branch.
    if (source !== "evaluation") return false;
  }
  const keys =
    source === "trace"
      ? SLIM_ELIGIBLE_TRACE_METRIC_KEYS
      : SLIM_ELIGIBLE_EVAL_METRIC_KEYS;
  return keys.has(s.metric);
}

function slimHandlesGroupBy(
  groupBy: string | undefined,
  source: AnalyticsMetricSource,
): boolean {
  if (!groupBy) return true;
  const keys =
    source === "trace" ? SLIM_TRACE_GROUP_BY_KEYS : SLIM_EVAL_GROUP_BY_KEYS;
  return keys.has(groupBy);
}

function slimHandlesFilters(
  filters: PickAnalyticsTableInput["filters"],
  source: AnalyticsMetricSource,
): boolean {
  if (!filters) return true;
  const allowed =
    source === "trace" ? SLIM_TRACE_FILTER_FIELDS : SLIM_EVAL_FILTER_FIELDS;
  for (const [field, value] of Object.entries(filters)) {
    if (!hasAnyFilterValue(value)) continue;
    if (!allowed.has(field as FilterField)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic — does `filters` reference a blocklisted attribute key via the
 * generic `metadata.key` / `metadata.value` filters? Mirrors the slim trim
 * service's blocklist; if a user is filtering on `gen_ai.prompt` we MUST
 * fall back because slim dropped the key at write time.
 */
function filtersHitBlocklist(
  filters: PickAnalyticsTableInput["filters"],
): boolean {
  if (!filters) return false;
  const metadataKey = filters["metadata.key"];
  if (metadataKey) {
    const keys = collectStringValues(metadataKey);
    for (const k of keys) {
      if (isBlocklisted(k)) return true;
    }
  }
  // metadata.value is keyed by the underlying metadata key — if the key on
  // the outer record is blocklisted we cannot read the value off slim either.
  const metadataValue = filters["metadata.value"];
  if (
    metadataValue &&
    typeof metadataValue === "object" &&
    !Array.isArray(metadataValue)
  ) {
    for (const outerKey of Object.keys(metadataValue)) {
      if (isBlocklisted(outerKey)) return true;
    }
  }
  return false;
}

function isBlocklisted(key: string): boolean {
  if (PAYLOAD_BLOCKLIST_EXACT.has(key)) return true;
  for (const prefix of PAYLOAD_BLOCKLIST_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function hasAnyFilterValue(
  value:
    | string[]
    | Record<string, string[]>
    | Record<string, Record<string, string[]>>
    | undefined,
): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "object") return false;
  for (const inner of Object.values(value)) {
    if (Array.isArray(inner)) {
      if (inner.length > 0) return true;
      continue;
    }
    if (typeof inner === "object" && inner !== null) {
      for (const v of Object.values(inner)) {
        if (Array.isArray(v) && v.length > 0) return true;
      }
    }
  }
  return false;
}

function collectStringValues(
  value:
    | string[]
    | Record<string, string[]>
    | Record<string, Record<string, string[]>>,
): string[] {
  if (Array.isArray(value)) return value;
  const out: string[] = [];
  for (const inner of Object.values(value)) {
    if (Array.isArray(inner)) {
      out.push(...inner);
      continue;
    }
    if (typeof inner === "object" && inner !== null) {
      for (const v of Object.values(inner)) {
        if (Array.isArray(v)) out.push(...v);
      }
    }
  }
  return out;
}

/** Test-only helper to export the per-source sets for inspection. */
export const __testOnly__ = {
  ROLLUP_TRACE_GROUP_BY_KEYS,
  ROLLUP_EVAL_GROUP_BY_KEYS,
  SLIM_TRACE_GROUP_BY_KEYS,
  SLIM_EVAL_GROUP_BY_KEYS,
  ROLLUP_TRACE_FILTER_FIELDS,
  ROLLUP_EVAL_FILTER_FIELDS,
  SLIM_TRACE_FILTER_FIELDS,
  SLIM_EVAL_FILTER_FIELDS,
  ROLLUP_TRACE_AGGREGATIONS,
  ROLLUP_EVAL_AGGREGATIONS,
};

/**
 * Analytics table routing — ADR-034 Phase 3 (app-layer module), extended in
 * Phase 6 to cover the eval pipeline.
 *
 * Picks ONE of six ClickHouse tables to serve a `getTimeseries` query:
 *
 *   TRACE-source paths:
 *   - `trace_analytics_rollup` — additive `SimpleAggregateFunction(sum, …)`
 *     bucketed by `(TenantId, BucketStart, Model, SpanType)` (migration 00038).
 *     Cheap, but only ever serves UNGROUPED additive sums (plus the one
 *     avg in `ROLLUP_AVG_METRIC_KEYS`) on metrics that live as a column on
 *     the rollup, with no filters on dimensions the rollup is not keyed by.
 *     Its `Model` / `SpanType` keys exist to keep the merged row count low;
 *     they are NOT group-by targets, because the rollup attributes metrics
 *     per SPAN while every other path attributes them per TRACE (see
 *     `ROLLUP_TRACE_GROUP_BY_KEYS`).
 *
 *   - `trace_analytics` — slim `ReplacingMergeTree(UpdatedAt)`, one row per
 *     trace, hoisted dim columns + a heuristically-trimmed `Attributes` map
 *     (migration 00039). Serves percentiles, late/rich-dim group-bys,
 *     hoisted-column filters, metadata.* / langwatch.reserved.* attribute reads,
 *     arbitrary attribute keys whose values are known to fit ≤ 256 chars.
 *
 *   - `trace_summaries` — legacy fallback, UNCHANGED.
 *
 *   EVAL-source paths (Phase 6):
 *   - `evaluation_analytics_rollup` — additive `SimpleAggregateFunction(sum, …)`
 *     bucketed by `(TenantId, BucketStart, EvaluatorType, Status)` (00040).
 *   - `evaluation_analytics` — slim `ReplacingMergeTree(UpdatedAt)`, one row
 *     per evaluation, hoisted dim columns + trimmed Attributes (00041).
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

import type { SeriesInputType } from "~/server/analytics/registry";
import type { AggregationTypes } from "~/server/analytics/types";
import {
  PAYLOAD_BLOCKLIST_EXACT,
  PAYLOAD_BLOCKLIST_PREFIXES,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/analytics-attribute-trim.service";
import type { FilterField } from "@langwatch/contracts/filters";
import {
  collectStringValues,
  hasFilterValues,
} from "../query-builders/_shared";
import {
  type AnalyticsMetricSource,
  getMetricSource,
} from "./field-availability";

/** The six destination tables routed between. */
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
 * the rollup column set (migration 00038 — see
 * `traceAnalyticsRollup.mapProjection.ts`):
 *
 *   CostSum, NonBilledCostSum, DurationSum (root), PromptTokensSum,
 *   CompletionTokensSum, CacheReadTokensSum, CacheWriteTokensSum,
 *   ReasoningTokensSum, SpanCount, TraceCount (root), ErrorCount.
 *
 * Distinct trace counts over arbitrary dims (TraceUniq) are NOT in the
 * rollup — that requires `AggregateFunction(uniq, …)` (binary state), and the
 * rollup only has `SimpleAggregateFunction(sum, …)`. `metadata.trace_id`
 * (cardinality) therefore routes to slim instead. Plain per-bucket trace
 * counts ARE available additively via `sum(TraceCount)` (1 per root span).
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
 * see migration 00040 + `evaluationAnalyticsRollup.mapProjection.ts`.
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

export const ROLLUP_ROLLABLE_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  [
    ...ROLLUP_ROLLABLE_TRACE_METRIC_KEYS_LIST,
    ...ROLLUP_ROLLABLE_EVAL_METRIC_KEYS_LIST,
  ],
);

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

/**
 * Narrower guards for callers that only want trace- or eval-scoped rollable
 * keys — used by the per-source SQL builders so their exhaustive switches
 * type-narrow correctly.
 */
export function isRollupRollableTraceMetricKey(
  metric: string,
): metric is TraceRollupMetricKey {
  return ROLLUP_ROLLABLE_TRACE_METRIC_KEYS.has(metric);
}

export function isSlimEligibleTraceMetricKey(
  metric: string,
): metric is SlimTraceMetricKey {
  return SLIM_ELIGIBLE_TRACE_METRIC_KEYS.has(metric);
}

// ─── Slim eligibility ────────────────────────────────────────────────

/**
 * The subset of rollable metrics whose `avg` can be served from the rollup as
 * `sum(<MetricSum>) / nullIf(sum(TraceCount), 0)` — a per-TRACE mean, which is
 * what the legacy path computes.
 *
 * Only `performance.completion_time` qualifies, because parity with legacy
 * `avg(column)` requires the trace_summaries column to be NON-NULLABLE (CH
 * `avg` skips NULLs, shrinking legacy's denominator to "traces where the
 * metric is present"; `sum/TraceCount` divides by ALL rooted traces).
 * `TotalDurationMs` is Int64 NOT NULL, so every trace counts on both paths.
 * Cost and token columns are Nullable — a rollup avg for those needs a
 * per-metric non-null trace count the rollup doesn't carry, so they stay on
 * slim (whose one-row-per-trace shape reproduces NULL-skipping for free).
 *
 * Known accepted divergences for completion_time (same class already
 * accepted for sums): rollup duration is the ROOT SPAN's own duration while
 * legacy folds max(end)-min(start), and rootless traces contribute neither
 * duration nor TraceCount to the rollup.
 */
const ROLLUP_AVG_METRIC_KEYS_LIST = ["performance.completion_time"] as const;
export type RollupAvgMetricKey = (typeof ROLLUP_AVG_METRIC_KEYS_LIST)[number];
export const ROLLUP_AVG_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  ROLLUP_AVG_METRIC_KEYS_LIST,
);

export function isRollupAvgMetricKey(
  metric: string,
): metric is RollupAvgMetricKey {
  return ROLLUP_AVG_METRIC_KEYS.has(metric);
}

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
 * see migration 00041 + `evaluationAnalytics.foldProjection.ts`.
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
 * Group-by keys the trace rollup may serve: NONE. The rollup is an ungrouped
 * fast-path only.
 *
 * It is *keyed* by `(…, Model, SpanType)` so that same-minute spans sharing a
 * model and span type merge into one row — that is a storage concern, not a
 * read contract. Grouping on those keys is not parity-safe:
 *
 *   - **Attribution flips from per-trace to per-span.** Legacy attributes a
 *     trace's WHOLE metric to every model the trace used
 *     (`arrayJoin(if(empty(Models), ['unknown'], Models))` over trace-level
 *     `TotalCost` — see `aggregation-builder.ts`, whose comment records this
 *     as a deliberate anti-double-counting choice). The rollup instead splits
 *     the metric across each span's own model. Both are defensible; they are
 *     not the same number, and `sum` over all buckets differs too (legacy
 *     over-counts multi-model traces; the rollup totals exactly).
 *   - **Root-only columns collapse into one bucket.** `DurationSum`,
 *     `TraceCount` and `ErrorCount` are recorded on the ROOT span only. A root
 *     span is usually a workflow/agent span carrying no model, so grouping
 *     `sum(performance.completion_time)` by model puts ~100% of duration in
 *     the `'unknown'` bucket and reports 0 for every real model. Whether that
 *     happens depends on whether the customer wraps their LLM call in a parent
 *     span — i.e. the same query returns different shapes for different SDK
 *     usage.
 *
 * `metadata.model` therefore routes to slim, which is one row per trace with a
 * `Models Array(String)` and trace-level metric columns — structurally the
 * same shape `trace_summaries` has, so it reproduces legacy exactly.
 * `metadata.span_type` has no slim column at all (span type is per-span; slim
 * is per-trace) and so falls back to `trace_summaries`.
 *
 * INVARIANT: this set must stay a subset of `SLIM_TRACE_GROUP_BY_KEYS` —
 * anything the rollup can group by, slim must also be able to group by, since
 * slim is the strictly more capable table. The same invariant binds the eval
 * pair below. Pinned by a test in `route-table.unit.test.ts`.
 */
const ROLLUP_TRACE_GROUP_BY_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Eval-rollup group-by keys — the dims final at evaluation-completion time
 * AND on the rollup's keying tuple (see migration 00040):
 *   {none, EvaluatorType, Status}.
 */
const ROLLUP_EVAL_GROUP_BY_KEYS: ReadonlySet<string> = new Set([
  // eval5014-002: `evaluations.evaluator_type` is DELIBERATELY excluded.
  // The rollup's map projection emits `evaluatorType: ''` on the two-event
  // (scheduled → completed) path because it has no fold-state access to
  // lift the identity — grouping by EvaluatorType on the rollup would pile
  // every two-event evaluation into a phantom "unknown" bucket. Route
  // EvaluatorType-grouped queries to slim/legacy instead.
  "evaluations.evaluation_status",
]);

/**
 * Group-by keys the slim trace table carries (typed columns + Attributes reads).
 *
 * `metadata.model` belongs HERE, not on the rollup. Slim's `Models` is a
 * per-trace deduplicated array and its metric columns are trace-level, so
 * `arrayJoin(if(empty(Models), ['unknown'], Models))` reproduces the legacy
 * expression character-for-character (`aggregation-builder.ts`) — same
 * buckets, same `'unknown'` label, same whole-trace attribution to every model
 * the trace used. Routing model group-bys to slim is therefore parity-safe AND
 * still a fast path. The rollup's per-span `Model` is the odd one out; see
 * `ROLLUP_TRACE_GROUP_BY_KEYS`.
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
  "metadata.model",
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
const SLIM_EVAL_FILTER_FIELDS: ReadonlySet<FilterField> = new Set<FilterField>([
  "metadata.key",
  "metadata.value",
]);

/**
 * Aggregations the trace rollup can compute CORRECTLY from its columns. The
 * rollup carries `SimpleAggregateFunction(sum, …)` columns — one summed
 * value per (bucket, model, span_type):
 *
 *   - `sum(col)`     → the additive total. Correct.
 *   - `avg(col)`     → naive `avg(col)` would be the mean of per-bucket SUMS
 *                      (merge-state-dependent, wrong). The builder instead
 *                      computes `sum(col) / nullIf(sum(TraceCount), 0)` — a
 *                      true per-trace mean — but ONLY for the metrics in
 *                      ROLLUP_AVG_METRIC_KEYS (non-nullable legacy columns)
 *                      and ONLY ungrouped: TraceCount lands in the ROOT
 *                      span's (Model, SpanType) bucket while metric sums
 *                      spread across every bucket the trace touched, so a
 *                      grouped division would use the wrong denominator.
 *   - `min/max(col)` → min/max of per-bucket sums, which changes value
 *                      across background merges. Non-deterministic + wrong.
 *                      Excluded; routes to slim.
 */
const ROLLUP_SUM_AGGREGATION: AggregationTypes = "sum";
const ROLLUP_AVG_AGGREGATION: AggregationTypes = "avg";

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
  /** Narrow the scan to an explicit trace set. Legacy-builder-only. */
  traceIds?: string[];
  /** Invert the user's filter selection (toolbar toggle). Legacy-builder-only. */
  negateFilters?: boolean;
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

  // Filter negation and explicit trace scoping only exist in the legacy
  // builder. Serving such a query from slim/rollup would silently ignore the
  // parameter — non-negated results for a negated query, all traces for a
  // trace-scoped one.
  if (input.negateFilters) return legacyFallbackFor(source);
  if (input.traceIds && input.traceIds.length > 0) {
    return legacyFallbackFor(source);
  }

  // Reject anything reading a blocklisted attribute key via metadata.key /
  // metadata.value — those values were dropped from slim's trimmed
  // Attributes map and only survive on the legacy table.
  if (filtersHitBlocklist(input.filters)) return legacyFallbackFor(source);

  // ---------- Rollup eligibility ----------
  const rollupOk =
    !hasPipeline &&
    rollupHandlesAllSeries(input.series, source, input.groupBy) &&
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
  groupBy?: string,
): boolean {
  return series.every((s) => rollupHandlesSeries(s, source, groupBy));
}

function rollupHandlesSeries(
  s: SeriesInputType,
  source: AnalyticsMetricSource,
  groupBy?: string,
): boolean {
  // A `key` on an eval series is an evaluator ID. NEITHER fast-path table can
  // filter by it: the rollup is keyed on `EvaluatorType` (a slug, which an ID
  // never equals) and the slim row hoists `EvaluatorType` too — neither
  // carries an `EvaluatorId` column (migrations 00040 / 00041). Serving a
  // keyed series from either would silently aggregate across every evaluator
  // in the project, so keyed series fall to `evaluation_runs`, the only table
  // that can express the predicate. Trace-source metrics carry no key today.
  if (s.key !== undefined || s.subkey !== undefined) return false;
  if (source === "evaluation") {
    if (!ROLLUP_EVAL_AGGREGATIONS.has(s.aggregation)) return false;
    return ROLLUP_ROLLABLE_EVAL_METRIC_KEYS.has(s.metric);
  }
  // Trace source: `sum` for every rollable metric; `avg` only ungrouped and
  // only for ROLLUP_AVG_METRIC_KEYS — TraceCount is the denominator and it
  // lands in the ROOT span's (Model, SpanType) bucket, so a grouped division
  // would use the wrong denominator. `!groupBy` mirrors
  // rollupHandlesGroupBy's "no group" test (undefined and "" both mean
  // ungrouped).
  if (!ROLLUP_ROLLABLE_TRACE_METRIC_KEYS.has(s.metric)) return false;
  if (s.aggregation === ROLLUP_SUM_AGGREGATION) return true;
  if (s.aggregation === ROLLUP_AVG_AGGREGATION) {
    return !groupBy && ROLLUP_AVG_METRIC_KEYS.has(s.metric);
  }
  return false;
}

function rollupHandlesGroupBy(
  groupBy: string | undefined,
  source: AnalyticsMetricSource,
): boolean {
  if (!groupBy) return true;
  const keys =
    source === "trace" ? ROLLUP_TRACE_GROUP_BY_KEYS : ROLLUP_EVAL_GROUP_BY_KEYS;
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
  // Same reasoning as the rollup branch: an eval `key` is an evaluator ID and
  // the slim row has no `EvaluatorId` column, so keyed series go to
  // `evaluation_runs` rather than being silently blended across evaluators.
  if (s.key !== undefined || s.subkey !== undefined) return false;
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

// hasAnyFilterValue + collectStringValues moved to query-builders/_shared.ts
// (used by both slim + rollup builders too). Aliased below to preserve
// the local name at call sites.
const hasAnyFilterValue = hasFilterValues;

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
  ROLLUP_EVAL_AGGREGATIONS,
};

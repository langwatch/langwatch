/**
 * Analytics table routing — picks ONE of six ClickHouse tables (trace/eval
 * × rollup/slim/legacy) to serve a `getTimeseries` query. Full decision
 * table, invariants and rationale: ADR-034.
 */

import type { AnalyticsSeries, AnalyticsAggregation } from "@langwatch/analytics-contract";

import {
  type AnalyticsMetricSource,
  getMetricSource,
} from "../../rules/analytics-field-availability.rules.ts";
import {
  PAYLOAD_BLOCKLIST_EXACT,
  PAYLOAD_BLOCKLIST_PREFIXES,
} from "../../rules/analytics-payload-blocklist.rules.ts";
import {
  collectStringValues,
  EVAL_METRIC_KEYS,
  type EvalMetricKey,
  hasFilterValues,
} from "./clickhouse.timeseries-query-shared.mapper.ts";

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
 * Registry metric keys servable from `trace_analytics_rollup`'s additive
 * columns (migration 00038). `TraceUniq`-shaped distinct counts are not
 * among them — see ADR-034.
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
export type TraceRollupMetricKey = (typeof ROLLUP_ROLLABLE_TRACE_METRIC_KEYS_LIST)[number];

/**
 * Registry metric keys servable from `evaluation_analytics_rollup`'s
 * additive columns (migration 00040) — aggregation formulas in ADR-034
 * ("Eval fields").
 */
export type EvalRollupMetricKey = EvalMetricKey;

/** Backwards-compatible union — all rollup-rollable metric keys, any source. */
export type RollupRollableMetricKey = TraceRollupMetricKey | EvalRollupMetricKey;

export const ROLLUP_ROLLABLE_METRIC_KEYS: ReadonlySet<string> = new Set<string>([
  ...ROLLUP_ROLLABLE_TRACE_METRIC_KEYS_LIST,
  ...EVAL_METRIC_KEYS,
]);

export function isRollupRollableMetricKey(metric: string): metric is RollupRollableMetricKey {
  return ROLLUP_ROLLABLE_METRIC_KEYS.has(metric);
}

const ROLLUP_ROLLABLE_TRACE_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  ROLLUP_ROLLABLE_TRACE_METRIC_KEYS_LIST,
);
const ROLLUP_ROLLABLE_EVAL_METRIC_KEYS: ReadonlySet<string> = new Set<string>(EVAL_METRIC_KEYS);

/**
 * Narrower guards for callers that only want trace- or eval-scoped rollable
 * keys — used by the per-source SQL builders so their exhaustive switches
 * type-narrow correctly.
 */
export function isRollupRollableTraceMetricKey(metric: string): metric is TraceRollupMetricKey {
  return ROLLUP_ROLLABLE_TRACE_METRIC_KEYS.has(metric);
}

export function isSlimEligibleTraceMetricKey(metric: string): metric is SlimTraceMetricKey {
  return SLIM_ELIGIBLE_TRACE_METRIC_KEYS.has(metric);
}

// ─── Slim eligibility ────────────────────────────────────────────────

/**
 * The one rollable metric whose `avg` is servable from the rollup as a true
 * per-trace mean: `completion_time`, whose legacy column is non-nullable
 * (parity requires that — see ADR-034, Read routing).
 */
const ROLLUP_AVG_METRIC_KEYS_LIST = ["performance.completion_time"] as const;
export type RollupAvgMetricKey = (typeof ROLLUP_AVG_METRIC_KEYS_LIST)[number];
export const ROLLUP_AVG_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  ROLLUP_AVG_METRIC_KEYS_LIST,
);

export function isRollupAvgMetricKey(metric: string): metric is RollupAvgMetricKey {
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
export type SlimTraceMetricKey = (typeof SLIM_ELIGIBLE_TRACE_METRIC_KEYS_LIST)[number];

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
export type SlimEvalMetricKey = (typeof SLIM_ELIGIBLE_EVAL_METRIC_KEYS_LIST)[number];

export type SlimEligibleMetricKey = SlimTraceMetricKey | SlimEvalMetricKey;

export const SLIM_ELIGIBLE_METRIC_KEYS: ReadonlySet<string> = new Set<string>([
  ...SLIM_ELIGIBLE_TRACE_METRIC_KEYS_LIST,
  ...SLIM_ELIGIBLE_EVAL_METRIC_KEYS_LIST,
]);

export function isSlimEligibleMetricKey(metric: string): metric is SlimEligibleMetricKey {
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
 * Group-by keys the trace rollup serves: NONE — grouping by its (Model,
 * SpanType) storage keys is not parity-safe (see ADR-034, Read routing).
 * Must stay a subset of `SLIM_TRACE_GROUP_BY_KEYS` (route-table.unit.test.ts).
 */
const ROLLUP_TRACE_GROUP_BY_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Eval-rollup group-by keys — the dims final at evaluation-completion time
 * AND on the rollup's keying tuple (see migration 00040):
 *   {none, EvaluatorType, Status}.
 */
const ROLLUP_EVAL_GROUP_BY_KEYS: ReadonlySet<string> = new Set([
  // `evaluations.evaluator_type` is DELIBERATELY excluded (eval5014-002):
  // the rollup's two-event fold path can't lift the identity, so grouping
  // by it would pile everything into a phantom "unknown" bucket — see
  // ADR-034 (Eval fields).
  "evaluations.evaluation_status",
]);

/**
 * Group-by keys the slim trace table carries. `metadata.model` is absent
 * (whole-trace attribution double-counts multi-model traces) and
 * `metadata.span_type` has no slim column — see ADR-034, Read routing.
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
const ROLLUP_TRACE_FILTER_FIELDS: ReadonlySet<string> = new Set<string>();

/** Eval-rollup filter fields — fields on the rollup's keying tuple. */
const ROLLUP_EVAL_FILTER_FIELDS: ReadonlySet<string> = new Set<string>();

/** Slim-trace filter fields (typed columns + trimmed Attributes reads). */
const SLIM_TRACE_FILTER_FIELDS: ReadonlySet<string> = new Set<string>([
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
]);

/** Slim-eval filter fields — typed columns on the slim row. */
const SLIM_EVAL_FILTER_FIELDS: ReadonlySet<string> = new Set<string>([
  "metadata.key",
  "metadata.value",
]);

/**
 * Aggregations the trace rollup computes CORRECTLY: `sum`; `avg` only for
 * `ROLLUP_AVG_METRIC_KEYS` and only ungrouped; `min`/`max` excluded
 * (merge-state-dependent on summed columns) — see ADR-034, Read routing.
 */
const ROLLUP_SUM_AGGREGATION: AnalyticsAggregation = "sum";
const ROLLUP_AVG_AGGREGATION: AnalyticsAggregation = "avg";

/**
 * Aggregations the eval rollup computes CORRECTLY: `sum`, weighted `avg`,
 * and `cardinality`. `min`/`max` are excluded (eval5014-P1) — see ADR-034
 * (Eval fields).
 */
const ROLLUP_EVAL_AGGREGATIONS: ReadonlySet<AnalyticsAggregation> = new Set<AnalyticsAggregation>([
  "sum",
  "avg",
  "cardinality",
]);

/**
 * Input shape for the routing decision. Mirrors the relevant subset of
 * `TimeseriesInputType` — kept tight so the function stays trivially testable.
 */
export interface PickAnalyticsTableInput {
  series: AnalyticsSeries[];
  filters?: Partial<
    Record<string, string[] | Record<string, string[]> | Record<string, Record<string, string[]>>>
  >;
  groupBy?: string;
  /** Narrow the scan to an explicit trace set. Legacy-builder-only. */
  traceIds?: string[];
  /** Invert the user's filter selection (toolbar toggle). Legacy-builder-only. */
  negateFilters?: boolean;
  /** Trace origins left out of the count. The rollup has no origin column. */
  excludeOrigins?: string[];
}

/**
 * Decide which ClickHouse table serves a `getTimeseries` query: source-
 * aware (all series must share one metric source, else the trace legacy
 * table), then rollup -> slim -> legacy fallback in that order per source.
 */
export function pickAnalyticsTable(input: PickAnalyticsTableInput): AnalyticsTable {
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

  // The rollup is keyed by bucket, not by trace, so it has no origin to leave
  // out: an origin exclusion reads the per-trace tables.
  const excludesOrigins = input.excludeOrigins !== undefined && input.excludeOrigins.length > 0;

  // ---------- Rollup eligibility ----------
  const rollupOk =
    !hasPipeline &&
    !excludesOrigins &&
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
  series: AnalyticsSeries[],
  source: AnalyticsMetricSource,
  groupBy?: string,
): boolean {
  return series.every((s) => rollupHandlesSeries(s, source, groupBy));
}

function rollupHandlesSeries(
  s: AnalyticsSeries,
  source: AnalyticsMetricSource,
  groupBy?: string,
): boolean {
  // A `key` on an eval series is an evaluator ID; neither fast table has an
  // EvaluatorId column (only EvaluatorType, a slug) — serving it would
  // silently aggregate across every evaluator, so keyed series fall to
  // `evaluation_runs`, the only table that can express the predicate.
  if (s.key !== undefined || s.subkey !== undefined) return false;
  if (source === "evaluation") {
    if (!ROLLUP_EVAL_AGGREGATIONS.has(s.aggregation)) return false;
    return ROLLUP_ROLLABLE_EVAL_METRIC_KEYS.has(s.metric);
  }
  // Trace source: `sum` for every rollable metric; `avg` only ungrouped and
  // only for ROLLUP_AVG_METRIC_KEYS — TraceCount lands in the ROOT span's
  // bucket while metric sums spread across every bucket touched, so a
  // grouped division would use the wrong denominator.
  if (!ROLLUP_ROLLABLE_TRACE_METRIC_KEYS.has(s.metric)) return false;
  if (s.aggregation === ROLLUP_SUM_AGGREGATION) return true;
  if (s.aggregation === ROLLUP_AVG_AGGREGATION) {
    return !groupBy && ROLLUP_AVG_METRIC_KEYS.has(s.metric);
  }
  return false;
}

function rollupHandlesGroupBy(groupBy: string | undefined, source: AnalyticsMetricSource): boolean {
  if (!groupBy) return true;
  const keys = source === "trace" ? ROLLUP_TRACE_GROUP_BY_KEYS : ROLLUP_EVAL_GROUP_BY_KEYS;
  return keys.has(groupBy);
}

function rollupHandlesFilters(
  filters: PickAnalyticsTableInput["filters"],
  source: AnalyticsMetricSource,
): boolean {
  if (!filters) return true;
  const allowed = source === "trace" ? ROLLUP_TRACE_FILTER_FIELDS : ROLLUP_EVAL_FILTER_FIELDS;
  for (const [field, value] of Object.entries(filters)) {
    if (!hasAnyFilterValue(value)) continue;
    if (!allowed.has(field as string)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Slim predicates
// ---------------------------------------------------------------------------

function slimHandlesAllSeries(series: AnalyticsSeries[], source: AnalyticsMetricSource): boolean {
  return series.every((s) => slimHandlesSeries(s, source));
}

function slimHandlesSeries(s: AnalyticsSeries, source: AnalyticsMetricSource): boolean {
  // Pipeline series group by a dim then re-aggregate the groups; the slim
  // builder only emits the flat inner aggregation, silently returning the
  // wrong number (e.g. total distinct traces for "avg traces per user",
  // trace5012-P0). Route all pipeline series to legacy until slim supports it.
  if (s.pipeline) return false;
  // Same reasoning as the rollup branch: an eval `key` is an evaluator ID and
  // the slim row has no `EvaluatorId` column, so keyed series go to
  // `evaluation_runs` rather than being silently blended across evaluators.
  if (s.key !== undefined || s.subkey !== undefined) return false;
  const keys =
    source === "trace" ? SLIM_ELIGIBLE_TRACE_METRIC_KEYS : SLIM_ELIGIBLE_EVAL_METRIC_KEYS;
  return keys.has(s.metric);
}

function slimHandlesGroupBy(groupBy: string | undefined, source: AnalyticsMetricSource): boolean {
  if (!groupBy) return true;
  const keys = source === "trace" ? SLIM_TRACE_GROUP_BY_KEYS : SLIM_EVAL_GROUP_BY_KEYS;
  return keys.has(groupBy);
}

function slimHandlesFilters(
  filters: PickAnalyticsTableInput["filters"],
  source: AnalyticsMetricSource,
): boolean {
  if (!filters) return true;
  const allowed = source === "trace" ? SLIM_TRACE_FILTER_FIELDS : SLIM_EVAL_FILTER_FIELDS;
  for (const [field, value] of Object.entries(filters)) {
    if (!hasAnyFilterValue(value)) continue;
    if (!allowed.has(field as string)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Does `filters` reference a blocklisted attribute key via `metadata.key`/
 * `metadata.value`? Mirrors the slim trim service's blocklist — slim
 * dropped that key at write time, so such a filter MUST fall back.
 */
function filtersHitBlocklist(filters: PickAnalyticsTableInput["filters"]): boolean {
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
  if (metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue)) {
    for (const outerKey of Object.keys(metadataValue)) {
      if (isBlocklisted(outerKey)) return true;
    }
  }
  return false;
}

function isBlocklisted(key: string): boolean {
  if (PAYLOAD_BLOCKLIST_EXACT[key] === true) return true;
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

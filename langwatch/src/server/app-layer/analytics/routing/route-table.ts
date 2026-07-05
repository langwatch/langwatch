/**
 * Analytics table routing — ADR-034 Phase 3 (app-layer module).
 *
 * This is the ADR-034 read router. Picks ONE of three ClickHouse tables to
 * serve a `getTimeseries` query:
 *
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
 *   - `trace_summaries` — the legacy/fallback path, UNCHANGED. Anything reading
 *     a dropped field (ComputedInput/Output, ErrorMessage, AnnotationIds,
 *     Events, RAG, …), anything reading a blocklisted attribute key (gen_ai.
 *     prompt/completion/response.choices/finish_reasons / OpenInference,
 *     Mastra, Traceloop input.value/output.value / LangWatch input/output,
 *     llm.input_messages/output_messages, RAG retrieval.documents), or anything
 *     that just doesn't match the rollup/slim shape — served by the legacy SQL
 *     builder in `~/server/analytics/clickhouse/aggregation-builder.ts`
 *     (untouched by this rewrite).
 *
 * Defaults: **on any doubt, return `trace_summaries`.** Slim/rollup are opt-in
 * optimisations — the fallback is the safe path. The function is pure and
 * exhaustively defensive; every "should this go to rollup/slim?" path lists
 * explicit allow-conditions and bails to `trace_summaries` if any are missing.
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

/** The three destination tables routed between. */
export type AnalyticsTable =
  | "trace_analytics_rollup"
  | "trace_analytics"
  | "trace_summaries";

/**
 * Registry metric keys ("<group>.<metric>") that can be served from
 * `trace_analytics_rollup` for additive aggregations. Derived directly from
 * the rollup column set (migration 00037 — see
 * `trace_analytics_rollup.mapProjection.ts`):
 *
 *   CostSum, NonBilledCostSum, DurationSum (root), PromptTokensSum,
 *   CompletionTokensSum, CacheReadTokensSum, CacheWriteTokensSum,
 *   ReasoningTokensSum, SpanCount, ErrorCount.
 *
 * Distinct trace counts (TraceUniq) are NOT in the rollup — Phase 1 removed
 * the uniq column because that requires `AggregateFunction(uniq, …)`
 * (binary state), and the rollup only has `SimpleAggregateFunction(sum, …)`.
 * `metadata.trace_id` (cardinality) therefore routes to slim instead.
 */
const ROLLUP_ROLLABLE_METRIC_KEYS_LIST = [
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
export type RollupRollableMetricKey =
  (typeof ROLLUP_ROLLABLE_METRIC_KEYS_LIST)[number];
export const ROLLUP_ROLLABLE_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  ROLLUP_ROLLABLE_METRIC_KEYS_LIST,
);

export function isRollupRollableMetricKey(
  metric: string,
): metric is RollupRollableMetricKey {
  return ROLLUP_ROLLABLE_METRIC_KEYS.has(metric);
}

/**
 * Registry metric keys that can be served from the slim `trace_analytics`
 * table. These have a typed column or are an attribute read off the trimmed
 * Attributes map. (RAG / event / sentiment / evaluation metrics intentionally
 * NOT here — they need stored_spans / evaluation_runs joins; slim is
 * trace-only.)
 */
const SLIM_ELIGIBLE_METRIC_KEYS_LIST = [
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
export type SlimEligibleMetricKey =
  (typeof SLIM_ELIGIBLE_METRIC_KEYS_LIST)[number];
export const SLIM_ELIGIBLE_METRIC_KEYS: ReadonlySet<string> = new Set<string>(
  SLIM_ELIGIBLE_METRIC_KEYS_LIST,
);

export function isSlimEligibleMetricKey(
  metric: string,
): metric is SlimEligibleMetricKey {
  return SLIM_ELIGIBLE_METRIC_KEYS.has(metric);
}

/**
 * Group-by keys the rollup is keyed by — {none, Model, SpanType}. Anything
 * else (topic, origin, user, conversation, labels, …) forces slim or fallback.
 */
const ROLLUP_GROUP_BY_KEYS: ReadonlySet<string> = new Set([
  "metadata.model",
  "metadata.span_type",
]);

/**
 * Group-by keys the slim table carries (typed columns + Attributes reads).
 *
 * `metadata.model` is DELIBERATELY EXCLUDED here. Slim's `Models` is a
 * per-trace deduplicated array (every model the trace ever used); the rollup's
 * `Model` is per-span (the actual model that produced each span's cost). If a
 * query groups by model with a filter the rollup can't serve, routing to slim
 * would silently flip semantics — a trace using gpt-4 AND tools would attribute
 * its whole cost to gpt-4 in slim, vs. correctly split per-span in rollup. We
 * fall back to trace_summaries instead so the answer is at least self-consistent
 * with what users see today.
 *
 * `metadata.span_type` requires a stored_spans join (not on slim).
 * Evaluation / event / sentiment / error groupings need joined tables.
 */
const SLIM_GROUP_BY_KEYS: ReadonlySet<string> = new Set([
  "topics.topics",
  "traces.trace_name",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
]);

/**
 * Filter fields the rollup is keyed by. Anything outside this set forces
 * slim / fallback.
 */
const ROLLUP_FILTER_FIELDS: ReadonlySet<FilterField> = new Set<FilterField>();

/**
 * Filter fields the slim table can serve from typed columns or the trimmed
 * Attributes map. `metadata.key` / `metadata.value` read arbitrary keys — the
 * slim Attributes map always carries `metadata.*` and `langwatch.reserved.*`
 * (under a 4 KiB cap), so those are safe. Filters on blocklisted keys force
 * fallback (checked separately).
 */
const SLIM_FILTER_FIELDS: ReadonlySet<FilterField> = new Set<FilterField>([
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

/**
 * Aggregations the rollup can compute CORRECTLY from its columns. The rollup
 * carries `SimpleAggregateFunction(sum, …)` columns only — one summed value per
 * (bucket, model, span_type). Only `sum` is well-defined:
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
const ROLLUP_AGGREGATIONS: ReadonlySet<AggregationTypes> = new Set<AggregationTypes>([
  "sum",
]);

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
 * Order of evaluation (any failure cascades to the next-fallback):
 *   1. Try `trace_analytics_rollup` — strictest, fastest.
 *   2. Try `trace_analytics` (slim).
 *   3. Otherwise `trace_summaries` (legacy, untouched).
 */
export function pickAnalyticsTable(
  input: PickAnalyticsTableInput,
): AnalyticsTable {
  // Empty series → can't route confidently; fall back.
  if (!input.series || input.series.length === 0) return "trace_summaries";

  // Pipeline (per-user/per-thread/per-customer) aggregations require trace-level
  // dim values that change after the spans land — those reads only make sense
  // against the slim table (per-trace) or trace_summaries. Never the rollup.
  const hasPipeline = input.series.some((s) => s.pipeline !== undefined);

  // Series-level filters complicate the routing — bail out conservatively to
  // trace_summaries when any series carries its own filter set, because per-
  // series filters can read fields neither slim nor rollup carries.
  const hasSeriesFilters = input.series.some(
    (s) => s.filters !== undefined && Object.keys(s.filters).length > 0,
  );
  if (hasSeriesFilters) return "trace_summaries";

  // Reject anything reading a blocklisted attribute key via metadata.key /
  // metadata.value — those values were dropped from slim's trimmed Attributes
  // map and only survive on trace_summaries.
  if (filtersHitBlocklist(input.filters)) return "trace_summaries";

  // ---------- Rollup eligibility ----------
  const rollupOk =
    !hasPipeline &&
    rollupHandlesAllSeries(input.series) &&
    rollupHandlesGroupBy(input.groupBy) &&
    rollupHandlesFilters(input.filters);
  if (rollupOk) return "trace_analytics_rollup";

  // ---------- Slim eligibility ----------
  const slimOk =
    slimHandlesAllSeries(input.series) &&
    slimHandlesGroupBy(input.groupBy) &&
    slimHandlesFilters(input.filters);
  if (slimOk) return "trace_analytics";

  // ---------- Default safe fallback ----------
  return "trace_summaries";
}

// ---------------------------------------------------------------------------
// Rollup predicates
// ---------------------------------------------------------------------------

function rollupHandlesAllSeries(series: SeriesInputType[]): boolean {
  return series.every((s) => rollupHandlesSeries(s));
}

function rollupHandlesSeries(s: SeriesInputType): boolean {
  if (!ROLLUP_AGGREGATIONS.has(s.aggregation)) return false;
  if (s.key !== undefined || s.subkey !== undefined) return false;
  return ROLLUP_ROLLABLE_METRIC_KEYS.has(s.metric);
}

function rollupHandlesGroupBy(groupBy?: string): boolean {
  if (!groupBy) return true;
  return ROLLUP_GROUP_BY_KEYS.has(groupBy);
}

function rollupHandlesFilters(
  filters: PickAnalyticsTableInput["filters"],
): boolean {
  if (!filters) return true;
  for (const [field, value] of Object.entries(filters)) {
    if (!hasAnyFilterValue(value)) continue;
    if (!ROLLUP_FILTER_FIELDS.has(field as FilterField)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Slim predicates
// ---------------------------------------------------------------------------

function slimHandlesAllSeries(series: SeriesInputType[]): boolean {
  return series.every((s) => slimHandlesSeries(s));
}

function slimHandlesSeries(s: SeriesInputType): boolean {
  // Pipeline aggregations (per-user / per-thread / per-customer / per-trace)
  // group by a dim then re-aggregate the groups. The slim builder does NOT
  // implement the outer re-aggregation — it only ever emits the flat inner
  // aggregation, silently returning e.g. the total distinct trace count for
  // an "average traces per user" query (trace5012-P0). Until the slim builder
  // grows real pipeline support, route ALL pipeline series to the legacy
  // fallback, which computes the two-level aggregation correctly.
  if (s.pipeline) return false;
  if (s.key !== undefined || s.subkey !== undefined) return false;
  return SLIM_ELIGIBLE_METRIC_KEYS.has(s.metric);
}

function slimHandlesGroupBy(groupBy?: string): boolean {
  if (!groupBy) return true;
  return SLIM_GROUP_BY_KEYS.has(groupBy);
}

function slimHandlesFilters(
  filters: PickAnalyticsTableInput["filters"],
): boolean {
  if (!filters) return true;
  for (const [field, value] of Object.entries(filters)) {
    if (!hasAnyFilterValue(value)) continue;
    if (!SLIM_FILTER_FIELDS.has(field as FilterField)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic — does `filters` reference a blocklisted attribute key via the
 * generic `metadata.key` / `metadata.value` filters? Mirrors the slim trim
 * service's blocklist; if a user is filtering on `gen_ai.prompt` we MUST hit
 * trace_summaries because slim dropped the key at write time.
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
  if (metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue)) {
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

/** Test-only helper to export the blocklist sets for inspection. */
export const __testOnly__ = {
  ROLLUP_GROUP_BY_KEYS,
  SLIM_GROUP_BY_KEYS,
  ROLLUP_FILTER_FIELDS,
  SLIM_FILTER_FIELDS,
  ROLLUP_AGGREGATIONS,
};

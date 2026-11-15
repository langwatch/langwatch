/**
 * Rollup SQL builder for `trace_analytics_rollup` (ADR-034 Phase 3), deliberately separate
 * from legacy `aggregation-builder.ts` (`trace_summaries`): the rollup is bucketed and additive,
 * so none of legacy's JOINs, dedup or fan-out apply. Unsupported shapes throw as routing bugs.
 */

import type { AnalyticsAggregation } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  fn,
  param,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import {
  isRollupAvgMetricKey,
  isRollupRollableTraceMetricKey,
  type TraceRollupMetricKey,
} from "./clickhouse.analytics-route-table.mapper.ts";
import { buildMetricAlias } from "./clickhouse.metric-translator.mapper.ts";
import {
  dateBucket,
  inEitherPeriod,
  type Measure,
  periodOf,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";

type Rollup = Measure<"trace_analytics_rollup">;
import { traceAnalyticsRollup as ra } from "./clickhouse.trace-analytics-rollup.table.ts";

/**
 * Aggregations the rollup can serve, mirroring the router's eligibility (route-table.ts): `sum`
 * for every rollable metric, `avg` only for `ROLLUP_AVG_METRIC_KEYS` ungrouped. min/max are NOT
 * servable -- merge-state-dependent -- and throw rather than silently return wrong numbers.
 */
type RollupAggregation = Extract<AnalyticsAggregation, "sum" | "avg">;

/**
 * Maps an additive registry metric to its rollup column expression. Narrowed to
 * `TraceRollupMetricKey` so the compiler enforces the complete switch; the caller validates via
 * `isRollupRollableTraceMetricKey` before dispatching.
 */
function rollupColumnFor(metric: TraceRollupMetricKey): Rollup {
  switch (metric) {
    case "performance.total_cost":
      return ra.CostSum;
    case "performance.cost_non_billed":
      return ra.NonBilledCostSum;
    case "performance.cost_billed":
      // Billed = total - non-billed (rollup carries both sums).
      return fn.minus(ra.CostSum, ra.NonBilledCostSum);
    case "performance.completion_time":
      return ra.DurationSum;
    case "performance.prompt_tokens":
      return ra.PromptTokensSum;
    case "performance.completion_tokens":
      return ra.CompletionTokensSum;
    case "performance.cache_read_tokens":
      return ra.CacheReadTokensSum;
    case "performance.cache_write_tokens":
      return ra.CacheWriteTokensSum;
    case "performance.reasoning_tokens":
      return ra.ReasoningTokensSum;
    // Total tokens count the cache reads and writes: input is the fresh remainder.
    case "performance.total_tokens":
    case "performance.total_processed_tokens":
      return fn.plus(
        fn.plus(ra.PromptTokensSum, ra.CompletionTokensSum),
        fn.plus(ra.CacheReadTokensSum, ra.CacheWriteTokensSum),
      );
    default: {
      // Exhaustiveness: `metric` should narrow to `never` here. If a new
      // entry is added to TraceRollupMetricKey, this assignment fails
      // at compile time.
      const _exhaustive: never = metric;
      throw new Error(
        `Rollup builder cannot serve metric "${String(_exhaustive)}". The router should have routed this to slim or trace_summaries.`,
      );
    }
  }
}

/**
 * Rollup serves UNGROUPED queries only: `Model`/`SpanType` look like group-by keys but attribute
 * metrics per span (legacy/slim do per trace), and root-only columns change meaning if grouped.
 * The router already redirects grouped queries elsewhere; this throw backstops a regression.
 */
function assertRollupUngrouped(groupBy?: string): void {
  if (!groupBy) return;
  throw new Error(
    `Rollup builder cannot group by "${groupBy}" — the rollup attributes metrics per span and carries root-only Duration/TraceCount/ErrorCount, so grouped reads diverge from legacy. The router should have routed this to slim or trace_summaries.`,
  );
}

function isRollupAggregation(agg: AnalyticsAggregation): agg is RollupAggregation {
  return agg === "sum" || agg === "avg";
}

/**
 * Aggregations supported: NO `*Merge` combinator, just plain `sum(col)`. `sum` is the additive
 * total; `avg` is `sum(col) / nullIf(sum(TraceCount), 0)`, a true per-trace mean since TraceCount
 * is 1 per root span (migration 00038) -- only `ROLLUP_AVG_METRIC_KEYS` divide correctly.
 */
function rollupAggExpression({
  agg,
  column,
  metric,
}: {
  agg: RollupAggregation;
  column: Rollup;
  metric: TraceRollupMetricKey;
}): Rollup {
  switch (agg) {
    case "sum":
      return fn.coalesce(fn.sum(column), param.float64(0));
    case "avg": {
      if (!isRollupAvgMetricKey(metric)) {
        throw new Error(
          `Rollup builder cannot serve avg(${metric}) — only non-nullable legacy columns divide correctly by TraceCount. The router should have routed this to slim.`,
        );
      }
      return fn.divide(fn.sum(column), fn.nullIf(fn.sum(ra.TraceCount), 0));
    }
    default: {
      const _exhaustive: never = agg;
      throw new Error(
        `Rollup builder cannot serve aggregation "${String(_exhaustive)}". Percentiles, min/max + distinct counts go to slim.`,
      );
    }
  }
}

/**
 * The rollup read of `trace_analytics_rollup`: the period, an optional date bucket and one
 * aggregate per series, ungrouped only, over the proof's windows on `BucketStart`.
 * @see assertRollupUngrouped
 */
export function rollupTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  assertRollupUngrouped(input.groupBy);
  const bucketed = typeof input.timeScale === "number";
  const period = periodOf(ra.BucketStart, input);
  const date = bucketed
    ? dateBucket(ra.BucketStart, input.timeScale as number, input.timeZone ?? "UTC")
    : undefined;

  const selection: Record<string, Rollup> = { period };
  if (date) selection.date = date;
  input.series.forEach((s, i) => {
    if (!isRollupRollableTraceMetricKey(s.metric)) {
      throw new Error(
        `Rollup builder cannot serve metric "${s.metric}". The router should have routed this to slim or trace_summaries.`,
      );
    }
    if (!isRollupAggregation(s.aggregation)) {
      throw new Error(
        `Rollup builder cannot serve aggregation "${s.aggregation}". Percentiles, min/max + distinct counts go to slim.`,
      );
    }
    const alias = buildMetricAlias({
      index: i,
      metric: s.metric,
      aggregation: s.aggregation,
      key: s.key,
      subkey: s.subkey,
    });
    selection[alias] = rollupAggExpression({
      agg: s.aggregation,
      column: rollupColumnFor(s.metric),
      metric: s.metric,
    });
  });

  const keys = date ? [period, date] : [period];
  // The period range on the partition column BucketStart prunes both periods' partitions.
  const read = clickhouseRead({ scope })
    .from(ra)
    .withinWindows()
    .select(selection)
    .where(() => inEitherPeriod(ra.BucketStart, input))
    .groupBy(...keys)
    .orderBy("period");
  return (date ? read.orderBy("date") : read)
    .settings({ ...settings, log_comment: "analytics:timeseries:trace_analytics_rollup" })
    .build() as ReaderReadStatement;
}

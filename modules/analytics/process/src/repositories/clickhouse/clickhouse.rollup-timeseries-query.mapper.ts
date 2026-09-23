/**
 * Rollup SQL builder for `trace_analytics_rollup` (ADR-034 Phase 3), deliberately separate
 * from legacy `aggregation-builder.ts` (`trace_summaries`): the rollup is bucketed and additive,
 * so none of legacy's JOINs, dedup or fan-out apply. Unsupported shapes throw as routing bugs.
 */

import type {
  AnalyticsAggregation,
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "@langwatch/analytics-contract";

import {
  isRollupAvgMetricKey,
  isRollupRollableTraceMetricKey,
  type TraceRollupMetricKey,
} from "./clickhouse.analytics-route-table.mapper.ts";
import { buildMetricAlias } from "./clickhouse.metric-translator.mapper.ts";
import { dateTrunc } from "./clickhouse.timeseries-query-shared.mapper.ts";

const ROLLUP_TABLE = "trace_analytics_rollup" as const;
const ra = "ra";

/**
 * Aggregations the rollup can serve, mirroring the router's eligibility (route-table.ts): `sum`
 * for every rollable metric, `avg` only for `ROLLUP_AVG_METRIC_KEYS` ungrouped. min/max are NOT
 * servable -- merge-state-dependent -- and throw rather than silently return wrong numbers.
 */
export type RollupAggregation = Extract<AnalyticsAggregation, "sum" | "avg">;

/**
 * Maps an additive registry metric to its rollup column expression. Narrowed to
 * `TraceRollupMetricKey` so the compiler enforces the complete switch; the caller validates via
 * `isRollupRollableTraceMetricKey` before dispatching.
 */
function rollupColumnFor(metric: TraceRollupMetricKey): string {
  switch (metric) {
    case "performance.total_cost":
      return `${ra}.CostSum`;
    case "performance.cost_non_billed":
      return `${ra}.NonBilledCostSum`;
    case "performance.cost_billed":
      // Billed = total - non-billed (rollup carries both sums).
      return `(${ra}.CostSum - ${ra}.NonBilledCostSum)`;
    case "performance.completion_time":
      return `${ra}.DurationSum`;
    case "performance.prompt_tokens":
      return `${ra}.PromptTokensSum`;
    case "performance.completion_tokens":
      return `${ra}.CompletionTokensSum`;
    case "performance.cache_read_tokens":
      return `${ra}.CacheReadTokensSum`;
    case "performance.cache_write_tokens":
      return `${ra}.CacheWriteTokensSum`;
    case "performance.reasoning_tokens":
      return `${ra}.ReasoningTokensSum`;
    case "performance.total_tokens":
      return `(${ra}.PromptTokensSum + ${ra}.CompletionTokensSum)`;
    case "performance.total_processed_tokens":
      return `(${ra}.PromptTokensSum + ${ra}.CompletionTokensSum + ${ra}.CacheReadTokensSum + ${ra}.CacheWriteTokensSum)`;
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
  column: string;
  metric: TraceRollupMetricKey;
}): string {
  switch (agg) {
    case "sum":
      return `coalesce(sum(${column}), 0)`;
    case "avg": {
      if (!isRollupAvgMetricKey(metric)) {
        throw new Error(
          `Rollup builder cannot serve avg(${metric}) — only non-nullable legacy columns divide correctly by TraceCount. The router should have routed this to slim.`,
        );
      }
      return `sum(${column}) / nullIf(sum(${ra}.TraceCount), 0)`;
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
 * Builds a rollup query for `trace_analytics_rollup`: CASE-based period, optional date bucket,
 * one aggregate per series, ungrouped only.
 * @see assertRollupUngrouped
 */
export function buildRollupTimeseriesQuery(
  input: AnalyticsTimeseriesBuilderInput,
): BuiltAnalyticsQuery {
  const timeZone = input.timeZone ?? "UTC";

  const selectExprs: string[] = [];
  selectExprs.push(
    `CASE
      WHEN ${ra}.BucketStart >= {currentStart:DateTime64(3)} AND ${ra}.BucketStart < {currentEnd:DateTime64(3)} THEN 'current'
      WHEN ${ra}.BucketStart >= {previousStart:DateTime64(3)} AND ${ra}.BucketStart < {previousEnd:DateTime64(3)} THEN 'previous'
    END AS period`,
  );

  if (typeof input.timeScale === "number") {
    selectExprs.push(`${dateTrunc(`${ra}.BucketStart`, input.timeScale, timeZone)} AS date`);
  }

  assertRollupUngrouped(input.groupBy);

  for (let i = 0; i < input.series.length; i++) {
    const s = input.series[i]!;
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
    const expr = rollupAggExpression({
      agg: s.aggregation,
      column: rollupColumnFor(s.metric),
      metric: s.metric,
    });
    selectExprs.push(`${expr} AS ${alias}`);
  }

  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") groupByExprs.push("date");

  // Time-range predicate on the partition column BucketStart enables
  // partition pruning across both the current and previous periods.
  const sql = `
    SELECT
      ${selectExprs.join(",\n      ")}
    FROM ${ROLLUP_TABLE} ${ra}
    WHERE ${ra}.TenantId = {tenantId:String}
      AND (
        (${ra}.BucketStart >= {currentStart:DateTime64(3)} AND ${ra}.BucketStart < {currentEnd:DateTime64(3)})
        OR
        (${ra}.BucketStart >= {previousStart:DateTime64(3)} AND ${ra}.BucketStart < {previousEnd:DateTime64(3)})
      )
    GROUP BY ${groupByExprs.join(", ")}
    ORDER BY period${typeof input.timeScale === "number" ? ", date" : ""}
  `;

  return {
    sql,
    params: {
      tenantId: input.projectId,
      currentStart: input.startDate,
      currentEnd: input.endDate,
      previousStart: input.previousPeriodStartDate,
      previousEnd: input.startDate,
    },
  };
}

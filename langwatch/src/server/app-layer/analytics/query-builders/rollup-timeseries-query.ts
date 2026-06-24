/**
 * Rollup SQL builder for `trace_analytics_rollup` (ADR-034 Phase 3
 * app-layer module).
 *
 * Single source of truth for the SQL emitted against the rollup. Deliberately
 * separate from the legacy `~/server/analytics/clickhouse/aggregation-builder.ts`
 * (which targets `trace_summaries` and is left UNTOUCHED by this rewrite): the
 * legacy path threads JOINs to `stored_spans` / `evaluation_runs`,
 * deduplication CTEs around `ReplacingMergeTree(UpdatedAt)`, mixed eval/trace
 * fan-out fixes, and arrayJoin grouping; none of that applies here. The rollup
 * is bucketed and additive.
 *
 * Routing decides whether to call this builder (see `routing/route-table.ts`);
 * the builder only handles what the rollup supports — any unsupported shape
 * is a programmer error and throws.
 *
 * All queries:
 *   * include `WHERE TenantId = {tenantId:String}` as the FIRST predicate
 *     (multi-tenancy contract, CLAUDE.md);
 *   * filter on the partition column `BucketStart` so ClickHouse prunes
 *     partitions (clickhouse-queries best-practices).
 */

import { buildMetricAlias } from "~/server/analytics/clickhouse/metric-translator";
import type { AggregationTypes } from "~/server/analytics/types";
import {
  isRollupRollableMetricKey,
  type RollupRollableMetricKey,
} from "../routing/route-table";
import type {
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "../types";
import { dateTrunc } from "./_shared";

const ROLLUP_TABLE = "trace_analytics_rollup" as const;
const ra = "ra";

/** Aggregations the rollup can serve from its SimpleAggregateFunction(sum, …) columns. */
export type RollupAggregation = Extract<
  AggregationTypes,
  "sum" | "avg" | "min" | "max"
>;

/** Group-by columns the rollup is keyed by. */
export type RollupGroupByKey = "metadata.model" | "metadata.span_type";

/**
 * Map an additive registry metric to its rollup column expression.
 *
 * Narrowed to `RollupRollableMetricKey` so the compiler enforces the
 * complete switch — no chance of a typo silently throwing at runtime.
 * The caller (`buildRollupTimeseriesQuery`) validates each metric via
 * `isRollupRollableMetricKey` before dispatching.
 */
function rollupColumnFor(metric: RollupRollableMetricKey): string {
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
      // entry is added to RollupRollableMetricKey, this assignment fails
      // at compile time.
      const _exhaustive: never = metric;
      throw new Error(
        `Rollup builder cannot serve metric "${String(_exhaustive)}". The router should have routed this to slim or trace_summaries.`,
      );
    }
  }
}

function isRollupGroupByKey(groupBy: string): groupBy is RollupGroupByKey {
  return groupBy === "metadata.model" || groupBy === "metadata.span_type";
}

/**
 * Optional GROUP BY column expression for the rollup. Only `Model` and
 * `SpanType` are valid rollup keys; anything else throws.
 */
function rollupGroupByExpression(groupBy?: string): string | null {
  if (!groupBy) return null;
  if (!isRollupGroupByKey(groupBy)) {
    throw new Error(
      `Rollup builder cannot group by "${groupBy}". The router should have routed this to slim.`,
    );
  }
  switch (groupBy) {
    case "metadata.model":
      return `if(${ra}.Model = '', 'unknown', ${ra}.Model)`;
    case "metadata.span_type":
      return `if(${ra}.SpanType = '', 'unknown', ${ra}.SpanType)`;
    default: {
      const _exhaustive: never = groupBy;
      throw new Error(`Unhandled rollup group-by: ${String(_exhaustive)}`);
    }
  }
}

function isRollupAggregation(agg: AggregationTypes): agg is RollupAggregation {
  return agg === "sum" || agg === "avg" || agg === "min" || agg === "max";
}

/**
 * Aggregations supported by the rollup. The rollup column is already a
 * per-span SimpleAggregateFunction(sum, …), so `sum(col)` = the additive sum,
 * `avg(col)` = arithmetic mean of bucket-summed values, etc. NO `*Merge`
 * combinator — the simple variant takes plain `sum(col)`/`avg(col)`.
 */
function rollupAggExpression(
  agg: RollupAggregation,
  column: string,
): string {
  switch (agg) {
    case "sum":
      return `coalesce(sum(${column}), 0)`;
    case "avg":
      return `avg(${column})`;
    case "min":
      return `min(${column})`;
    case "max":
      return `max(${column})`;
    default: {
      const _exhaustive: never = agg;
      throw new Error(
        `Rollup builder cannot serve aggregation "${String(_exhaustive)}". Percentiles + distinct counts go to slim.`,
      );
    }
  }
}

/**
 * Build a rollup query for `trace_analytics_rollup`.
 *
 * Shape:
 *
 *   SELECT
 *     CASE … END AS period,
 *     <toStartOf… on BucketStart> AS date,        -- when timeScale numeric
 *     <group expr> AS group_key,                  -- when groupBy
 *     <agg(<rollup col>)> AS <alias>,             -- per series
 *     …
 *   FROM trace_analytics_rollup ra
 *   WHERE ra.TenantId = {tenantId:String}
 *     AND BucketStart in [previousStart, currentEnd)
 *   GROUP BY period [, date] [, group_key]
 *   ORDER BY period [, date]
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
    selectExprs.push(
      `${dateTrunc(`${ra}.BucketStart`, input.timeScale, timeZone)} AS date`,
    );
  }

  const groupByColumn = rollupGroupByExpression(input.groupBy);
  if (groupByColumn) {
    selectExprs.push(`${groupByColumn} AS group_key`);
  }

  for (let i = 0; i < input.series.length; i++) {
    const s = input.series[i]!;
    if (!isRollupRollableMetricKey(s.metric)) {
      throw new Error(
        `Rollup builder cannot serve metric "${s.metric}". The router should have routed this to slim or trace_summaries.`,
      );
    }
    if (!isRollupAggregation(s.aggregation)) {
      throw new Error(
        `Rollup builder cannot serve aggregation "${s.aggregation}". Percentiles + distinct counts go to slim.`,
      );
    }
    const alias = buildMetricAlias(i, s.metric, s.aggregation, s.key, s.subkey);
    const expr = rollupAggExpression(s.aggregation, rollupColumnFor(s.metric));
    selectExprs.push(`${expr} AS ${alias}`);
  }

  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") groupByExprs.push("date");
  if (groupByColumn) groupByExprs.push("group_key");

  const havingClause = groupByColumn ? `HAVING group_key != ''` : "";

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
    ${havingClause}
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

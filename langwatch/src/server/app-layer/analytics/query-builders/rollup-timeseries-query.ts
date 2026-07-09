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
  isRollupAvgMetricKey,
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

/**
 * Aggregations the rollup can serve from its SimpleAggregateFunction(sum, …)
 * columns. Exactly mirrors the router's eligibility (route-table.ts): `sum`
 * for every rollable metric; `avg` only for ROLLUP_AVG_METRIC_KEYS and only
 * ungrouped (TraceCount denominator — see rollupAggExpression). min/max are
 * NOT servable (min/max of per-part sums is merge-state-dependent) and THROW
 * here rather than silently returning wrong numbers if routing ever regresses.
 */
export type RollupAggregation = Extract<AggregationTypes, "sum" | "avg">;

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

/**
 * The rollup serves UNGROUPED queries only.
 *
 * Its `Model` / `SpanType` sort keys look like group-by targets but are not:
 * the rollup attributes metrics per span, while legacy and slim attribute them
 * per trace, and its `DurationSum` / `TraceCount` / `ErrorCount` columns are
 * recorded on the root span alone — so any grouping on those keys silently
 * changes what the number means. The router (`ROLLUP_GROUP_BY_KEYS`) already
 * sends every grouped query to slim or `trace_summaries`; this throw is the
 * backstop for a routing regression.
 */
function assertRollupUngrouped(groupBy?: string): void {
  if (!groupBy) return;
  throw new Error(
    `Rollup builder cannot group by "${groupBy}" — the rollup attributes metrics per span and carries root-only Duration/TraceCount/ErrorCount, so grouped reads diverge from legacy. The router should have routed this to slim or trace_summaries.`,
  );
}

function isRollupAggregation(agg: AggregationTypes): agg is RollupAggregation {
  return agg === "sum" || agg === "avg";
}

/**
 * Aggregations supported by the rollup. NO `*Merge` combinator — the simple
 * variant takes plain `sum(col)`.
 *
 *   - `sum` → the additive total over every span increment in range.
 *   - `avg` → a true PER-TRACE mean: `sum(col) / nullIf(sum(TraceCount), 0)`.
 *     TraceCount is 1 per root span (migration 00038), so the denominator is
 *     the number of rooted traces in the bucket. Only the metrics in
 *     `ROLLUP_AVG_METRIC_KEYS` divide correctly. Grouped queries never reach
 *     here — `assertRollupUngrouped` rejects them first.
 */
function rollupAggExpression({
  agg,
  column,
  metric,
}: {
  agg: RollupAggregation;
  column: string;
  metric: RollupRollableMetricKey;
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
 * Build a rollup query for `trace_analytics_rollup`.
 *
 * Shape:
 *
 *   SELECT
 *     CASE … END AS period,
 *     <toStartOf… on BucketStart> AS date,        -- when timeScale numeric
 *     <agg(<rollup col>)> AS <alias>,             -- per series
 *     …
 *   FROM trace_analytics_rollup ra
 *   WHERE ra.TenantId = {tenantId:String}
 *     AND BucketStart in [previousStart, currentEnd)
 *   GROUP BY period [, date]
 *   ORDER BY period [, date]
 *
 * Ungrouped only — see `assertRollupUngrouped`.
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

  assertRollupUngrouped(input.groupBy);

  for (let i = 0; i < input.series.length; i++) {
    const s = input.series[i]!;
    if (!isRollupRollableMetricKey(s.metric)) {
      throw new Error(
        `Rollup builder cannot serve metric "${s.metric}". The router should have routed this to slim or trace_summaries.`,
      );
    }
    if (!isRollupAggregation(s.aggregation)) {
      throw new Error(
        `Rollup builder cannot serve aggregation "${s.aggregation}". Percentiles, min/max + distinct counts go to slim.`,
      );
    }
    const alias = buildMetricAlias(i, s.metric, s.aggregation, s.key, s.subkey);
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

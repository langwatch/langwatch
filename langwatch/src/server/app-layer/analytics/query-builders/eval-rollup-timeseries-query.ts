/**
 * Rollup SQL builder for `evaluation_analytics_rollup` — ADR-034 Phase 6
 * (eval mirror of `rollup-timeseries-query.ts`).
 *
 * The eval rollup carries (ScoreSum, ScoreCount), (PassCount, FailCount),
 * (EvalCount, ErrorCount, SkippedCount), and DurationSum/CostSum/
 * NonBilledCostSum. Aggregations:
 *
 *   - `evaluation_score / avg`  → sum(ScoreSum) / nullIf(sum(ScoreCount), 0)
 *   - `evaluation_score / sum`  → sum(ScoreSum)
 *   - `evaluation_pass_rate / avg` → sum(PassCount) / nullIf(sum(PassCount) + sum(FailCount), 0)
 *   - `evaluation_runs / cardinality` → sum(EvalCount)
 *
 * The builder owns these compositions; routing only decides whether to
 * call it. Anything unsupported throws (programmer error — routing should
 * have selected the slim or legacy table).
 */

import { buildMetricAlias } from "~/server/analytics/clickhouse/metric-translator";
import type { AggregationTypes } from "~/server/analytics/types";
import type {
  AnalyticsTimeseriesBuilderInput,
  BuiltAnalyticsQuery,
} from "../types";
import { dateTrunc } from "./_shared";

const ROLLUP_TABLE = "evaluation_analytics_rollup" as const;
const ra = "ra";

export type EvalRollupAggregation = Extract<
  AggregationTypes,
  "sum" | "avg" | "min" | "max" | "cardinality"
>;

export type EvalRollupGroupByKey =
  | "evaluations.evaluator_type"
  | "evaluations.evaluation_status";

export type EvalRollupMetricKey =
  | "evaluations.evaluation_score"
  | "evaluations.evaluation_pass_rate"
  | "evaluations.evaluation_runs";

function isEvalRollupMetricKey(metric: string): metric is EvalRollupMetricKey {
  return (
    metric === "evaluations.evaluation_score" ||
    metric === "evaluations.evaluation_pass_rate" ||
    metric === "evaluations.evaluation_runs"
  );
}

function isEvalRollupGroupByKey(
  groupBy: string,
): groupBy is EvalRollupGroupByKey {
  return (
    groupBy === "evaluations.evaluator_type" ||
    groupBy === "evaluations.evaluation_status"
  );
}

function evalRollupGroupByExpression(groupBy?: string): string | null {
  if (!groupBy) return null;
  if (!isEvalRollupGroupByKey(groupBy)) {
    throw new Error(
      `Eval rollup builder cannot group by "${groupBy}". The router should have routed this to slim.`,
    );
  }
  switch (groupBy) {
    case "evaluations.evaluator_type":
      return `if(${ra}.EvaluatorType = '', 'unknown', ${ra}.EvaluatorType)`;
    case "evaluations.evaluation_status":
      return `${ra}.Status`;
    default: {
      const _exhaustive: never = groupBy;
      throw new Error(`Unhandled eval rollup group-by: ${String(_exhaustive)}`);
    }
  }
}

function isEvalRollupAggregation(
  agg: AggregationTypes,
): agg is EvalRollupAggregation {
  return (
    agg === "sum" ||
    agg === "avg" ||
    agg === "min" ||
    agg === "max" ||
    agg === "cardinality"
  );
}

/**
 * Build the aggregation SQL fragment for an eval rollup metric + aggregation.
 * Mirrors the metric-translator's behaviour for the trace rollup builder:
 * each (metric, agg) pair maps to a single SQL expression.
 */
function evalRollupAggExpression(
  metric: EvalRollupMetricKey,
  agg: EvalRollupAggregation,
): string {
  switch (metric) {
    case "evaluations.evaluation_score":
      switch (agg) {
        case "sum":
          return `sum(${ra}.ScoreSum)`;
        case "avg":
          return `sum(${ra}.ScoreSum) / nullIf(sum(${ra}.ScoreCount), 0)`;
        case "min":
          return `min(${ra}.ScoreSum / nullIf(${ra}.ScoreCount, 0))`;
        case "max":
          return `max(${ra}.ScoreSum / nullIf(${ra}.ScoreCount, 0))`;
        case "cardinality":
          return `sum(${ra}.ScoreCount)`;
        default: {
          const _exhaustive: never = agg;
          throw new Error(
            `Unhandled aggregation for evaluation_score: ${String(_exhaustive)}`,
          );
        }
      }
    case "evaluations.evaluation_pass_rate":
      // Pass rate is only meaningful as `avg` (the "fraction passed"). The
      // other aggregations fall through to sensible additive shapes so the
      // builder doesn't refuse what the router accepted.
      switch (agg) {
        case "sum":
          return `sum(${ra}.PassCount)`;
        case "avg":
          return `sum(${ra}.PassCount) / nullIf(sum(${ra}.PassCount) + sum(${ra}.FailCount), 0)`;
        case "min":
          return `min(${ra}.PassCount)`;
        case "max":
          return `max(${ra}.PassCount)`;
        case "cardinality":
          return `sum(${ra}.PassCount) + sum(${ra}.FailCount)`;
        default: {
          const _exhaustive: never = agg;
          throw new Error(
            `Unhandled aggregation for evaluation_pass_rate: ${String(_exhaustive)}`,
          );
        }
      }
    case "evaluations.evaluation_runs":
      switch (agg) {
        case "sum":
        case "cardinality":
          return `sum(${ra}.EvalCount)`;
        case "avg":
          return `avg(${ra}.EvalCount)`;
        case "min":
          return `min(${ra}.EvalCount)`;
        case "max":
          return `max(${ra}.EvalCount)`;
        default: {
          const _exhaustive: never = agg;
          throw new Error(
            `Unhandled aggregation for evaluation_runs: ${String(_exhaustive)}`,
          );
        }
      }
    default: {
      const _exhaustive: never = metric;
      throw new Error(
        `Eval rollup builder cannot serve metric "${String(_exhaustive)}". The router should have routed this to slim or evaluation_runs.`,
      );
    }
  }
}

export function buildEvalRollupTimeseriesQuery(
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

  const groupByColumn = evalRollupGroupByExpression(input.groupBy);
  if (groupByColumn) {
    selectExprs.push(`${groupByColumn} AS group_key`);
  }

  // rt5014-002 fix: the router refuses key-bearing series for eval rollup
  // (the rollup is keyed on EvaluatorType, has no EvaluatorId column, and
  // ignoring `s.key` would silently return cross-evaluator aggregates).
  // The builder throws loud below if a key ever reaches it, matching the
  // slim builder's contract.
  for (let i = 0; i < input.series.length; i++) {
    const s = input.series[i]!;
    if (!isEvalRollupMetricKey(s.metric)) {
      throw new Error(
        `Eval rollup builder cannot serve metric "${s.metric}". The router should have routed this to slim or evaluation_runs.`,
      );
    }
    if (!isEvalRollupAggregation(s.aggregation)) {
      throw new Error(
        `Eval rollup builder cannot serve aggregation "${s.aggregation}". Percentiles + uniq go to slim.`,
      );
    }
    if (s.key !== undefined) {
      throw new Error(
        `Eval rollup builder cannot serve series with key="${s.key}" — the router should have routed this to slim or evaluation_runs (no EvaluatorId column on evaluation_analytics_rollup; see migration 00039).`,
      );
    }
    const alias = buildMetricAlias(i, s.metric, s.aggregation, s.key, s.subkey);
    const expr = evalRollupAggExpression(s.metric, s.aggregation);
    selectExprs.push(`${expr} AS ${alias}`);
  }

  const groupByExprs: string[] = ["period"];
  if (typeof input.timeScale === "number") groupByExprs.push("date");
  if (groupByColumn) groupByExprs.push("group_key");

  const havingClause = groupByColumn ? `HAVING group_key != ''` : "";

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

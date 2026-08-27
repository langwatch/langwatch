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

import { buildMetricAlias } from "../clickhouse/metric-translator";
import type { AnalyticsAggregation } from "@langwatch/analytics-contract";
import type { AnalyticsTimeseriesBuilderInput, BuiltAnalyticsQuery } from "../types";
import { dateTrunc } from "./_shared";

const ROLLUP_TABLE = "evaluation_analytics_rollup" as const;
const ra = "ra";

/**
 * Aggregations the eval rollup can compute CORRECTLY from its
 * `SimpleAggregateFunction(sum, …)` columns — exactly mirroring the router's
 * `ROLLUP_EVAL_AGGREGATIONS`.
 *
 * `min`/`max` are DELIBERATELY absent. The rollup stores per-bucket sums, so
 * the best it could do is `min/max(ScoreSum / ScoreCount)` — the extremum of
 * per-bucket AVERAGES, which shifts as background merges combine parts and is
 * never the true worst/best score. Those route to the eval slim table (one row
 * per evaluation), where `min/max(Score)` is the real per-eval extremum.
 * Narrowing the type here makes the exhaustive switches below reject them at
 * compile time rather than silently returning merge-state noise.
 */
export type EvalRollupAggregation = Extract<AnalyticsAggregation, "sum" | "avg" | "cardinality">;

export type EvalRollupGroupByKey = "evaluations.evaluator_type" | "evaluations.evaluation_status";

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

function isEvalRollupGroupByKey(groupBy: string): groupBy is EvalRollupGroupByKey {
  return groupBy === "evaluations.evaluator_type" || groupBy === "evaluations.evaluation_status";
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

function isEvalRollupAggregation(agg: AnalyticsAggregation): agg is EvalRollupAggregation {
  return agg === "sum" || agg === "avg" || agg === "cardinality";
}

/**
 * Build the aggregation SQL fragment for an eval rollup metric + aggregation.
 * Mirrors the metric-translator's behaviour for the trace rollup builder:
 * each (metric, agg) pair maps to a single SQL expression.
 */
function evalRollupAggExpression(metric: EvalRollupMetricKey, agg: EvalRollupAggregation): string {
  // Verdict metrics (score, pass-rate) only read rows whose evaluation
  // actually ran to completion — an errored run's stray verdict must not
  // shift the chart (#6833). Matches the legacy per-evaluator path's
  // `Status = 'processed'` condition, and covers rollup rows written before
  // the projection zeroed Pass/FailCount on non-processed events.
  const processed = `${ra}.Status = 'processed'`;
  switch (metric) {
    case "evaluations.evaluation_score":
      switch (agg) {
        case "sum":
          return `sumIf(${ra}.ScoreSum, ${processed})`;
        case "avg":
          return `sumIf(${ra}.ScoreSum, ${processed}) / nullIf(sumIf(${ra}.ScoreCount, ${processed}), 0)`;
        case "cardinality":
          return `sumIf(${ra}.ScoreCount, ${processed})`;
        default: {
          const _exhaustive: never = agg;
          throw new Error(`Unhandled aggregation for evaluation_score: ${String(_exhaustive)}`);
        }
      }
    case "evaluations.evaluation_pass_rate":
      // Pass rate is only meaningful as `avg` (the "fraction passed"); `sum`
      // and `cardinality` fall through to their additive shapes.
      switch (agg) {
        case "sum":
          return `sumIf(${ra}.PassCount, ${processed})`;
        case "avg":
          return `sumIf(${ra}.PassCount, ${processed}) / nullIf(sumIf(${ra}.PassCount, ${processed}) + sumIf(${ra}.FailCount, ${processed}), 0)`;
        case "cardinality":
          return `sumIf(${ra}.PassCount, ${processed}) + sumIf(${ra}.FailCount, ${processed})`;
        default: {
          const _exhaustive: never = agg;
          throw new Error(`Unhandled aggregation for evaluation_pass_rate: ${String(_exhaustive)}`);
        }
      }
    case "evaluations.evaluation_runs":
      switch (agg) {
        case "sum":
        case "cardinality":
          return `sum(${ra}.EvalCount)`;
        case "avg":
          // `avg(EvalCount)` is the mean of per-bucket counts, not a per-eval
          // mean of anything — merge-state-dependent and meaningless. The
          // router never sends it here.
          throw new Error(
            "Eval rollup builder cannot serve avg(evaluations.evaluation_runs) — averaging per-bucket counts is merge-state-dependent. The router should have routed this to evaluation_runs.",
          );
        default: {
          const _exhaustive: never = agg;
          throw new Error(`Unhandled aggregation for evaluation_runs: ${String(_exhaustive)}`);
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
    selectExprs.push(`${dateTrunc(`${ra}.BucketStart`, input.timeScale, timeZone)} AS date`);
  }

  const groupByColumn = evalRollupGroupByExpression(input.groupBy);
  if (groupByColumn) {
    selectExprs.push(`${groupByColumn} AS group_key`);
  }

  // NOTE: this builder emits NO evaluator predicate. The rollup is keyed on
  // `EvaluatorType` (a slug) while an eval series' `key` carries an evaluator
  // ID, and the two never match — so a per-evaluator filter cannot be
  // expressed here. The router must therefore keep keyed eval series off the
  // rollup; see `rollupHandlesSeries` in `routing/route-table.ts`.
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

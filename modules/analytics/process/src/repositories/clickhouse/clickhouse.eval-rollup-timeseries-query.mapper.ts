/**
 * Rollup SQL builder for `evaluation_analytics_rollup` — ADR-034 Phase 6
 * (eval mirror of `rollup-timeseries-query.ts`). The builder owns these
 * aggregation compositions; anything unsupported throws (programmer error).
 */

import type { AnalyticsAggregation } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  cond,
  fn,
  param,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import { evaluationAnalyticsRollup as ra } from "./clickhouse.evaluation-analytics-rollup.table.ts";
import { buildMetricAlias } from "./clickhouse.metric-translator.mapper.ts";
import {
  dateBucket,
  type EvalMetricKey,
  inEitherPeriod,
  isEvalMetricKey,
  type Measure,
  periodOf,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";

type Rollup = Measure<"evaluation_analytics_rollup">;

/**
 * `min`/`max` are DELIBERATELY absent: the rollup only stores per-bucket
 * sums, so `min/max(ScoreSum/ScoreCount)` would be the extremum of
 * per-bucket AVERAGES, not the true per-eval extremum (route to slim for that).
 */
type EvalRollupAggregation = Extract<AnalyticsAggregation, "sum" | "avg" | "cardinality">;

type EvalRollupGroupByKey = "evaluations.evaluator_type" | "evaluations.evaluation_status";

function isEvalRollupGroupByKey(groupBy: string): groupBy is EvalRollupGroupByKey {
  return groupBy === "evaluations.evaluator_type" || groupBy === "evaluations.evaluation_status";
}

function buildEvalRollupGroupByExpression(groupBy?: string): Rollup | undefined {
  if (!groupBy) return undefined;
  if (!isEvalRollupGroupByKey(groupBy)) {
    throw new Error(
      `Eval rollup builder cannot group by "${groupBy}". The router should have routed this to slim.`,
    );
  }
  switch (groupBy) {
    case "evaluations.evaluator_type":
      return fn.if(cond.eq(ra.EvaluatorType, ""), param.string("unknown"), ra.EvaluatorType);
    case "evaluations.evaluation_status":
      return ra.Status;
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
function evalRollupAggExpression(metric: EvalMetricKey, agg: EvalRollupAggregation): Rollup {
  // Verdict metrics (score, pass-rate) only read rows whose evaluation
  // actually ran to completion — an errored run's stray verdict must not
  // shift the chart (#6833). Matches the legacy per-evaluator path's
  // `Status = 'processed'` condition, and covers rollup rows written before
  // the projection zeroed Pass/FailCount on non-processed events.
  const processed = cond.eq(ra.Status, "processed");
  const passes = fn.sumIf(ra.PassCount, processed);
  const fails = fn.sumIf(ra.FailCount, processed);
  switch (metric) {
    case "evaluations.evaluation_score":
      switch (agg) {
        case "sum":
          return fn.sumIf(ra.ScoreSum, processed);
        case "avg":
          return fn.divide(
            fn.sumIf(ra.ScoreSum, processed),
            fn.nullIf(fn.sumIf(ra.ScoreCount, processed), 0),
          );
        case "cardinality":
          return fn.sumIf(ra.ScoreCount, processed);
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
          return passes;
        case "avg":
          return fn.divide(passes, fn.nullIf(fn.plus(passes, fails), 0));
        case "cardinality":
          return fn.plus(passes, fails);
        default: {
          const _exhaustive: never = agg;
          throw new Error(`Unhandled aggregation for evaluation_pass_rate: ${String(_exhaustive)}`);
        }
      }
    case "evaluations.evaluation_runs":
      switch (agg) {
        case "sum":
        case "cardinality":
          return fn.sum(ra.EvalCount);
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

/** The rollup read of `evaluation_analytics_rollup`, over the proof's windows on `BucketStart`. */
export function evalRollupTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  const period = periodOf(ra.BucketStart, input);
  const date =
    typeof input.timeScale === "number"
      ? dateBucket(ra.BucketStart, input.timeScale, input.timeZone ?? "UTC")
      : undefined;
  const groupKey = buildEvalRollupGroupByExpression(input.groupBy);

  const selection: Record<string, Rollup> = { period };
  if (date) selection.date = date;
  if (groupKey) selection.group_key = groupKey;

  // NOTE: no evaluator predicate. The rollup is keyed on `EvaluatorType` (a slug) while an eval
  // series' `key` carries an evaluator ID, so the router keeps keyed eval series off the rollup
  // (`rollupHandlesSeries` in route-table.ts).
  input.series.forEach((s, i) => {
    if (!isEvalMetricKey(s.metric)) {
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
    const alias = buildMetricAlias({
      index: i,
      metric: s.metric,
      aggregation: s.aggregation,
      key: s.key,
      subkey: s.subkey,
    });
    selection[alias] = evalRollupAggExpression(s.metric, s.aggregation);
  });

  const keys = [period, ...(date ? [date] : []), ...(groupKey ? [groupKey] : [])];
  const grouped = clickhouseRead({ scope })
    .from(ra)
    .withinWindows()
    .select(selection)
    .where(() => inEitherPeriod(ra.BucketStart, input))
    .groupBy(...keys);
  const kept = groupKey ? grouped.having(({ ne }) => ne(groupKey, "")) : grouped;
  const ordered = kept.orderBy("period");
  return (date ? ordered.orderBy("date") : ordered)
    .settings({ ...settings, log_comment: "analytics:timeseries:evaluation_analytics_rollup" })
    .build() as ReaderReadStatement;
}

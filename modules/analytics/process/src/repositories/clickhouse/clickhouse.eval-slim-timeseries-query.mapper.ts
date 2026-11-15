/**
 * Slim SQL builder for `evaluation_analytics` (ADR-034 Phase 6); `pickAnalyticsTable` routes
 * here and an unsupported shape throws. Every query is fenced on `OccurredAt` by the proof's
 * `tenantScope` marker and dedups with `latestVersionSubquery`.
 */

import {
  clickhouseRead,
  column,
  type Condition,
  cond,
  type Expression,
  fn,
  param,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import { evaluationAnalytics as ea } from "./clickhouse.evaluation-analytics.table.ts";
import { buildMetricAlias } from "./clickhouse.metric-translator.mapper.ts";
import {
  dateBucket,
  type EvalMetricKey,
  groupKeyOf,
  hasFilterValues,
  inEitherPeriod,
  isEvalMetricKey,
  type Measure,
  periodOf,
  slimAggregate,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";

/** The columns a deduped evaluation may carry; a read carries only those its series name. */
const CARRIED = ["OccurredAt", "Status", "Score", "Passed", "EvaluatorType", "Label"] as const;
type Carried = (typeof CARRIED)[number];

/** The carried tuple, indexed by position. */
type CarriedRow = readonly unknown[] & { readonly [position: `${number}`]: unknown };

/** One evaluation's newest value of a carried column, and its id (the dedup key). */
type LatestEvaluation<T extends string> = {
  carried: (name: Carried) => Measure<T>;
  evaluationId: Measure<T>;
};

/** Group-by keys the eval slim builder serves. */
type EvalSlimGroupByKey =
  | "evaluations.evaluator_type"
  | "evaluations.evaluation_passed"
  | "evaluations.evaluation_label"
  | "evaluations.evaluation_status";

/** Eval-slim eligible metric keys (must match SLIM_ELIGIBLE_EVAL_METRIC_KEYS). */

/**
 * An eval metric's slim column. `Passed` is `Nullable(Bool)`, coerced with `toUInt8` so `avg`
 * reads as a pass rate. Verdict metrics null themselves on incomplete runs (#6833).
 */
function evalSlimColumnFor<T extends string>(
  metric: EvalMetricKey,
  { carried, evaluationId }: LatestEvaluation<T>,
): Measure<T> {
  const processed = cond.eq(carried("Status"), param.string("processed"));
  switch (metric) {
    case "evaluations.evaluation_score":
      return fn.if(processed, carried("Score"), fn.nullAs(column.nullable(column.float64())));
    case "evaluations.evaluation_pass_rate":
      return fn.toUInt8(
        fn.if(processed, carried("Passed"), fn.nullAs(column.nullable(column.bool()))),
      );
    case "evaluations.evaluation_runs":
      return evaluationId;
    default: {
      const _exhaustive: never = metric;
      throw new Error(
        `Eval slim builder cannot serve metric "${String(_exhaustive)}". The router should have routed this to evaluation_runs.`,
      );
    }
  }
}

function isEvalSlimGroupByKey(groupBy: string): groupBy is EvalSlimGroupByKey {
  switch (groupBy) {
    case "evaluations.evaluator_type":
    case "evaluations.evaluation_passed":
    case "evaluations.evaluation_label":
    case "evaluations.evaluation_status":
      return true;
    default:
      return false;
  }
}

function buildEvalSlimGroupByExpression<T extends string>(
  groupBy: string | undefined,
  { carried }: LatestEvaluation<T>,
): Measure<T> | undefined {
  if (!groupBy) return undefined;
  if (!isEvalSlimGroupByKey(groupBy)) {
    throw new Error(`Eval slim builder cannot group by "${groupBy}".`);
  }
  const unknown = param.string("unknown");
  const notProcessed = cond.ne(carried("Status"), param.string("processed"));
  switch (groupBy) {
    case "evaluations.evaluator_type": {
      const type = carried("EvaluatorType");
      return fn.if(cond.eq(type, param.string("")), unknown, type);
    }
    case "evaluations.evaluation_passed": {
      // Status-gated like the metric columns: a historical errored row carrying a stray verdict
      // buckets as 'unknown', not 'failed', as the legacy per-evaluator path does (#6833).
      const passed = carried("Passed");
      return fn.if(
        cond.or(notProcessed, cond.isNull(passed)),
        unknown,
        fn.if(passed as Condition<T>, param.string("passed"), param.string("failed")),
      );
    }
    case "evaluations.evaluation_label":
      // Same status gate: an errored run's label is not a verdict (#6833).
      return fn.if(notProcessed, unknown, fn.coalesce(carried("Label"), unknown));
    case "evaluations.evaluation_status":
      return carried("Status");
    default: {
      const _exhaustive: never = groupBy;
      throw new Error(`Unhandled eval slim group-by: ${String(_exhaustive)}`);
    }
  }
}

/**
 * The eval slim serves no filter fields (its Attributes hold only the
 * evaluation events' metadata), so `pickAnalyticsTable` routes every filtered
 * query to `evaluation_runs`. A filter reaching here is a routing bug.
 */
function refuseEvalSlimFilters(filters: TimeseriesQueryInput["filters"]): void {
  for (const [field, rawValue] of Object.entries(filters ?? {})) {
    if (!hasFilterValues(rawValue)) continue;
    throw new Error(
      `Eval slim builder cannot serve filter "${field}". The router should have routed this to evaluation_runs.`,
    );
  }
}

/** The series and the group key over one evaluation's newest version. */
function evalSlimShape<T extends string>(
  input: TimeseriesQueryInput,
  latest: LatestEvaluation<T>,
): { metrics: Record<string, Measure<T>>; groupKey: Measure<T> | undefined } {
  const grouping = buildEvalSlimGroupByExpression(input.groupBy, latest);
  const metrics: Record<string, Measure<T>> = {};
  input.series.forEach((s, i) => {
    if (!isEvalMetricKey(s.metric)) {
      throw new Error(
        `Eval slim builder cannot serve metric "${s.metric}". The router should have routed this to evaluation_runs.`,
      );
    }
    // `evaluation_analytics` hoists `EvaluatorType`, not `EvaluatorId`: a per-evaluator series
    // would blend every evaluator, so the router keeps keyed series on `evaluation_runs`.
    if (s.key !== undefined || s.subkey !== undefined) {
      throw new Error(
        `Eval slim builder cannot filter by evaluator key "${String(s.key)}" — evaluation_analytics has no EvaluatorId column. The router should have routed this to evaluation_runs.`,
      );
    }
    const alias = buildMetricAlias({
      index: i,
      metric: s.metric,
      aggregation: s.aggregation,
      key: s.key,
      subkey: s.subkey,
    });
    metrics[alias] = slimAggregate({
      aggregation: s.aggregation,
      of: evalSlimColumnFor(s.metric, latest),
      table: "eval slim",
    });
  });
  return { metrics, groupKey: grouping ? groupKeyOf(grouping) : undefined };
}

/**
 * The slim read of `evaluation_analytics`, UNKEYED series only. Each evaluation's newest version
 * in range is collapsed with a spillable `argMax` of a tuple (a NULL survives it) under the
 * proof's windows on `OccurredAt` (clickhouse-queries.md, "Whole-range aggregates").
 */
export function evalSlimTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  refuseEvalSlimFilters(input.filters);
  const used = new Set<Carried>(["OccurredAt"]);
  evalSlimShape(input, {
    carried: (name) => {
      used.add(name);
      return ea[name];
    },
    evaluationId: ea.EvaluationId,
  });
  const carried = CARRIED.filter((name) => used.has(name));

  const versions = clickhouseRead({ scope })
    .from(ea)
    .withinWindows()
    .select({
      TenantId: ea.TenantId,
      EvaluationId: ea.EvaluationId,
      __version: ea.UpdatedAt,
      __latest_row: fn.tuple(...carried.map((name) => ea[name])),
    })
    .where(() => inEitherPeriod(ea.OccurredAt, input))
    .as("versions");
  const latest = clickhouseRead({ scope })
    .from(versions)
    .select({
      TenantId: versions.TenantId,
      EvaluationId: versions.EvaluationId,
      __latest: fn.argMax(versions.__latest_row, versions.__version),
    })
    .groupBy(versions.TenantId, versions.EvaluationId)
    .as("ea");
  const row = latest.__latest as Expression<CarriedRow, "ea">;
  const newest: LatestEvaluation<"ea"> = {
    carried: (name) => fn.tupleElement(row, `${carried.indexOf(name)}`),
    evaluationId: latest.EvaluationId,
  };
  const { metrics, groupKey } = evalSlimShape(input, newest);
  const occurredAt = newest.carried("OccurredAt");
  const period = periodOf(occurredAt, input);
  const date =
    typeof input.timeScale === "number"
      ? dateBucket(occurredAt, input.timeScale, input.timeZone ?? "UTC")
      : undefined;

  const selection: Record<string, Measure<"ea">> = { period };
  if (date) selection.date = date;
  if (groupKey) selection.group_key = groupKey;
  Object.assign(selection, metrics);

  const keys = [period, ...(date ? [date] : []), ...(groupKey ? [groupKey] : [])];
  const grouped = clickhouseRead({ scope })
    .from(latest)
    .select(selection)
    .where(() => inEitherPeriod(occurredAt, input))
    .groupBy(...keys);
  const kept = groupKey ? grouped.having(({ ne }) => ne(groupKey, param.string(""))) : grouped;
  const ordered = kept.orderBy("period");
  return (date ? ordered.orderBy("date") : ordered)
    .settings({ ...settings, log_comment: "analytics:timeseries:evaluation_analytics" })
    .build() as ReaderReadStatement;
}

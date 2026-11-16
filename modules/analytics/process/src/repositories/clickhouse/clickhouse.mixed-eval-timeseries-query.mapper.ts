/**
 * Trace metrics mixed with evaluation metrics on the typed builder (ADR-202), as main's
 * buildMixedEvalTimeseriesQuery: one row per trace first, its runs aggregated there, so the join
 * never fans a trace metric out (issue #3088); then every series re-aggregated across traces.
 */

import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  type ClickHouseReadStart,
  type Condition,
  cond,
  fn,
  param,
  type ProofScope,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import { evaluationRuns as er } from "./clickhouse.evaluation-runs.table.ts";
import {
  countsTraces,
  distinctTraces,
  type MetricAggregate,
  type MetricOperand,
  type MetricPredicate,
  type MetricSource,
  type MetricSpec,
  renderMetric,
  shapeSeries,
} from "./clickhouse.metric-spec.mapper.ts";
import {
  allOf,
  currentPeriod,
  dateBucket,
  inEitherPeriod,
  type Measure,
  periodOf,
  previousPeriod,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";
import {
  filtersOf,
  GROUP_BYS,
  groupKeyFor,
  seriesAlias,
  type SeriesOps,
  seriesConditions,
  specOf,
} from "./clickhouse.trace-summaries-timeseries-query.mapper.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";

const EVALUATIONS = "evaluation_runs";
/** Main bounds the runs a week before the previous period, by schedule and by update. */
const RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

type Joined = "trace_summaries" | "runs";

const isEvaluation = (spec: MetricSpec) => spec.joins.includes(EVALUATIONS);

/**
 * Whether the mixed shape serves this query, as main routed it: no pipeline, every metric on the
 * trace row or the runs, at least one of each, series filters on the trace row alone.
 */
export function servesMixedEval(input: TimeseriesQueryInput): boolean {
  if (typeof input.timeScale !== "number" && input.timeScale !== "full") return false;
  if (input.groupBy && !GROUP_BYS[input.groupBy]) return false;
  const specs: MetricSpec[] = [];
  for (const [index, series] of input.series.entries()) {
    if (series.pipeline) return false;
    const spec = specOf(series, index);
    if (spec.outer || spec.form !== "scalar") return false;
    if (spec.joins.some((join) => join !== EVALUATIONS)) return false;
    specs.push(spec);
  }
  return specs.some(isEvaluation) && !specs.every(isEvaluation);
}

/** The latest version of each run since main's lookback, in the proof's windows. */
function runsRead(scope: ProofScope, input: TimeseriesQueryInput) {
  const since = param.epochMs(input.previousPeriodStartDate.getTime() - RUN_LOOKBACK_MS);
  return clickhouseRead({ scope })
    .from(er)
    .withinWindows()
    .select({
      TenantId: er.TenantId,
      TraceId: er.TraceId,
      EvaluatorId: er.EvaluatorId,
      EvaluationId: er.EvaluationId,
      Score: er.Score,
      Passed: er.Passed,
      Status: er.Status,
      Label: er.Label,
    })
    .where(({ and, gte }) => and(gte(er.ScheduledAt, since), gte(er.UpdatedAt, since)))
    .latestVersion()
    .as("runs");
}

/** The runs as a derived table, for the mixed read and the joined read. */
export type JoinedRuns = ReturnType<typeof runsRead>;

export function runsOf(scope: ProofScope, input: TimeseriesQueryInput): JoinedRuns {
  return runsRead(scope, input);
}

type PerTraceKeys = { period: boolean; date: boolean; groupKey: boolean };

/** Per trace: each run metric over its runs, each trace operand, condition and series filter. */
export function carriedPerTrace<
  T extends string,
  Tables extends string,
  Ctes extends Record<string, unknown>,
>({
  input,
  source,
  ops,
}: {
  input: TimeseriesQueryInput;
  source: MetricSource<T>;
  ops: SeriesOps<Tables, Ctes>;
}): Record<string, Measure<T>> {
  const carried: Record<string, Measure<T>> = {};
  for (const [index, series] of input.series.entries()) {
    const spec = specOf(series, index);
    const operand = spec.operand?.(source);
    const condition = spec.condition?.(source);
    if (isEvaluation(spec)) carried[`m${index}`] = renderMetric({ spec, source });
    else if (operand) carried[`v${index}`] = fn.any(operand);
    if (!isEvaluation(spec) && condition) carried[`c${index}`] = fn.any(condition);
    const conditions = seriesConditions({ series, input, ops });
    if (conditions.length > 0) carried[`f${index}`] = fn.any(allOf(conditions)) as Measure<T>;
  }
  return carried;
}

/**
 * One row per trace (and period, date and group): each run metric aggregated over the trace's
 * runs, each trace metric's operand and condition, and each series filter, carried with `any`.
 */
function perTraceRead({
  scope,
  input,
  inPeriod,
  keys,
  alias,
}: {
  scope: ProofScope;
  input: TimeseriesQueryInput;
  inPeriod: Condition<"trace_summaries">;
  keys: PerTraceKeys;
  alias: string;
}) {
  const runs = runsOf(scope, input);
  const source: MetricSource<Joined> = {
    trace: (name) => ts[name],
    attribute: (key) => fn.mapGet(ts.Attributes, key),
    span: () => {
      throw new Error("The mixed evaluation read joins no stored_spans.");
    },
    evaluation: (name) => runs[name] as Measure<Joined>,
  };
  const selection: Record<string, Measure<Joined>> = {
    TenantId: ts.TenantId,
    trace_id: ts.TraceId,
  };
  const groupBy: Measure<Joined>[] = [ts.TenantId, ts.TraceId];
  const keep = (name: string, measure: Measure<Joined>) => {
    selection[name] = measure;
    groupBy.push(measure);
  };
  if (keys.period) keep("period", periodOf(ts.OccurredAt, input));
  if (keys.date && typeof input.timeScale === "number") {
    keep("date", dateBucket(ts.OccurredAt, input.timeScale, input.timeZone ?? "UTC"));
  }
  const grouping = input.groupBy ? GROUP_BYS[input.groupBy] : undefined;
  if (keys.groupKey && grouping) keep("group_key", groupKeyFor(grouping));

  const { filters, restrictions } = filtersOf(input);
  return clickhouseRead({ scope })
    .from(ts)
    .withinWindows()
    .innerJoin(runs, ({ and, eq }) =>
      and(eq(runs.TenantId, ts.TenantId), eq(runs.TraceId, ts.TraceId)),
    )
    .select((ops) => ({ ...selection, ...carriedPerTrace({ input, source, ops }) }))
    .where(() => inPeriod)
    .where((ops) => allOf([filters(ops), ...restrictions]), { inElection: false })
    .latestVersion()
    .groupBy(...groupBy)
    .as(alias);
}

/** A run metric across traces: means average, counts add up (main's mapEvalAggregationToOuter). */
function acrossTraces(
  aggregate: MetricAggregate,
  perTrace: Measure,
  when: Condition<string> | undefined,
): Measure {
  switch (aggregate.fn) {
    case "avg":
    case "quantile":
      return when ? fn.avgIf(perTrace, when) : fn.avg(perTrace);
    case "min":
      return when ? fn.minIf(perTrace, when) : fn.min(perTrace);
    case "max":
      return when ? fn.maxIf(perTrace, when) : fn.max(perTrace);
    case "sum":
    case "uniq":
    case "count":
      return when ? fn.sumIf(perTrace, when) : fn.sum(perTrace);
  }
}

const NO_SOURCE: MetricSource<string> = {
  trace: () => {
    throw new Error("A per-trace measure reads its carried columns only.");
  },
  attribute: () => {
    throw new Error("A per-trace measure reads its carried columns only.");
  },
  span: () => {
    throw new Error("A per-trace measure reads its carried columns only.");
  },
  evaluation: () => {
    throw new Error("A per-trace measure reads its carried columns only.");
  },
};

/** A series over the per-trace rows, with its own filter and percentage mode. */
function seriesAcrossTraces({
  series,
  index,
  perTrace,
}: {
  series: AnalyticsSeries;
  index: number;
  perTrace: Record<string, Measure>;
}): Measure {
  const spec = specOf(series, index);
  const carried = (name: string) => perTrace[`${name}${index}`]!;
  const when = perTrace[`f${index}`] as Condition<string> | undefined;
  if (isEvaluation(spec)) {
    return shapeSeries({
      series,
      when,
      render: (filter) => acrossTraces(spec.aggregate, carried("m"), filter),
    });
  }
  if (countsTraces(spec)) {
    const ids = { tenantId: perTrace.TenantId!, traceId: carried("v") };
    return shapeSeries({
      series,
      when,
      render: (filter) => distinctTraces({ ...ids, when: filter }),
    });
  }
  const overTraces: MetricSpec = {
    ...spec,
    // The carried column stands for the operand and condition on every source.
    operand: spec.operand ? ((() => carried("v")) as MetricOperand) : undefined,
    condition: spec.condition ? ((() => carried("c")) as MetricPredicate) : undefined,
  };
  return shapeSeries({
    series,
    when,
    render: (filter) => renderMetric({ spec: overTraces, source: NO_SOURCE, when: filter }),
  });
}

/** Every series over the per-trace rows {@link carriedPerTrace} carried. */
export function measuresOver(
  input: TimeseriesQueryInput,
  perTrace: Record<string, Measure>,
): Record<string, Measure> {
  return Object.fromEntries(
    input.series.map((series, index) => [
      seriesAlias(series, index),
      seriesAcrossTraces({ series, index, perTrace }),
    ]),
  );
}

const LOG_COMMENT = "analytics:timeseries:trace_summaries:mixed_eval";

/** Full scale with no grouping: one row per period even when the period is empty. */
function summaryRead({ scope, input, settings }: TimeseriesRead): ReaderReadStatement {
  const arm = (start: ClickHouseReadStart<ProofScope>, period: "current" | "previous") => {
    const perTrace = perTraceRead({
      scope,
      input,
      inPeriod:
        period === "current"
          ? currentPeriod(ts.OccurredAt, input)
          : previousPeriod(ts.OccurredAt, input),
      keys: { period: false, date: false, groupKey: false },
      alias: `per_trace_${period}`,
    });
    const selection: Record<string, Measure> = {
      period: param.string(period),
      ...measuresOver(input, perTrace),
    };
    return start.from(perTrace).select(selection);
  };
  const periods = arm(clickhouseRead({ scope }), "current")
    .unionAll((start) => arm(start, "previous"))
    .as("periods");
  const keys = ["period", ...input.series.map((series, index) => seriesAlias(series, index))];
  return clickhouseRead({ scope })
    .from(periods)
    .select(Object.fromEntries(keys.map((key) => [key, periods[key]!])))
    .settings({ ...settings, log_comment: LOG_COMMENT })
    .build() as ReaderReadStatement;
}

/** Trace and evaluation metrics together; see {@link servesMixedEval}. */
export function mixedEvalTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  if (input.timeScale === "full" && !input.groupBy) return summaryRead({ scope, input, settings });
  const grouping = input.groupBy ? GROUP_BYS[input.groupBy] : undefined;
  const dated = typeof input.timeScale === "number";
  const perTrace = perTraceRead({
    scope,
    input,
    inPeriod: inEitherPeriod(ts.OccurredAt, input),
    keys: { period: true, date: dated, groupKey: grouping !== undefined },
    alias: "per_trace",
  });
  const selection: Record<string, Measure> = { period: perTrace.period! };
  if (dated) selection.date = perTrace.date!;
  if (grouping) selection.group_key = perTrace.group_key!;
  Object.assign(selection, measuresOver(input, perTrace));
  const keys = [perTrace.period!, ...(dated ? [perTrace.date!] : [])];
  if (grouping) keys.push(perTrace.group_key!);
  const grouped = clickhouseRead({ scope })
    .from(perTrace)
    .select(selection)
    .groupBy(...keys);
  const having =
    grouping && !grouping.handlesUnknown
      ? grouped.having(() => cond.ne(perTrace.group_key!, param.string("")))
      : grouped;
  const ordered = having.orderBy("period");
  return (dated ? ordered.orderBy("date") : ordered)
    .settings({ ...settings, log_comment: LOG_COMMENT })
    .build() as ReaderReadStatement;
}

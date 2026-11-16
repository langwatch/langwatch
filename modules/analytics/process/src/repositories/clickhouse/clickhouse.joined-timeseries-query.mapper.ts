/**
 * Trace summaries joined to their spans or evaluation runs on the typed builder (ADR-202), as
 * main's buildStandardTimeseriesQuery with joins: every joined row counts, so a trace with N spans
 * or runs is aggregated N times, as main did.
 */

import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  type ClickHouseRead,
  type Condition,
  column,
  cond,
  fn,
  param,
  type ProofScope,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import {
  type AnalyticsFilterInput,
  filterTranslations,
} from "./clickhouse.filter-conditions.mapper.ts";
import {
  type MetricSource,
  type MetricSpec,
  renderMetric,
  shapeSeries,
  type SpanMetricColumn,
} from "./clickhouse.metric-spec.mapper.ts";
import { runsOf } from "./clickhouse.mixed-eval-timeseries-query.mapper.ts";
import { storedSpans as ss } from "./clickhouse.stored-spans.table.ts";
import {
  allOf,
  dateBucket,
  groupKeyOf,
  inEitherPeriod,
  type Measure,
  periodOf,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";
import {
  filtersOf,
  GROUP_BYS,
  groupKeyFor,
  seriesAlias,
  seriesConditions,
  specOf,
} from "./clickhouse.trace-summaries-timeseries-query.mapper.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";

const SPANS = "stored_spans";
const EVALUATIONS = "evaluation_runs";
/** Main's StartTime envelope on the spans join: two days either side of both periods. */
const SPAN_MARGIN_MS = 2 * 24 * 60 * 60 * 1000;

type Runs = ReturnType<typeof runsOf>;
type Joined = "trace_summaries" | "spans" | "runs";

/** How an evaluation grouping reads the joined runs, and what its HAVING keeps. */
type RunGrouping = {
  key: (runs: Runs, evaluatorId: string | undefined) => Measure<Joined>;
  keeps: "non-empty" | "not-null" | "all";
};

const processedBy = (runs: Runs, evaluatorId: string) =>
  cond.and(
    cond.eq(runs.EvaluatorId, param.string(evaluatorId)),
    cond.eq(runs.Status, param.string("processed")),
  );

const NO_KEY = () => fn.nullAs(column.nullable(column.string()));

/** The evaluation groupings main joined `evaluation_runs` for (aggregation-builder:735-767). */
const RUN_GROUP_BYS: Record<string, (evaluatorId: string | undefined) => RunGrouping> = {
  "evaluations.evaluation_passed": (evaluatorId) => ({
    key: (runs) => {
      if (evaluatorId === undefined) {
        return fn.multiIf(
          [
            [cond.eq(runs.Passed, param.uint16(1)), param.string("passed")],
            [cond.eq(runs.Passed, param.uint16(0)), param.string("failed")],
          ],
          param.string("unknown"),
        ) as Measure<Joined>;
      }
      const ran = processedBy(runs, evaluatorId);
      return fn.multiIf(
        [
          [
            cond.and(ran, cond.isNotNull(runs.Passed), cond.eq(runs.Passed, param.uint16(1))),
            param.string("passed") as Measure<Joined>,
          ],
          [
            cond.and(ran, cond.isNotNull(runs.Passed), cond.eq(runs.Passed, param.uint16(0))),
            param.string("failed") as Measure<Joined>,
          ],
          [cond.and(ran, cond.isNull(runs.Passed)), param.string("unknown") as Measure<Joined>],
        ],
        NO_KEY() as Measure<Joined>,
      ) as Measure<Joined>;
    },
    keeps: evaluatorId === undefined ? "all" : "not-null",
  }),
  "evaluations.evaluation_label": (evaluatorId) => ({
    key: (runs) =>
      groupKeyOf(
        evaluatorId === undefined
          ? runs.Label
          : fn.if(processedBy(runs, evaluatorId), runs.Label, param.string("")),
      ) as Measure<Joined>,
    keeps: "non-empty",
  }),
  "evaluations.evaluation_processing_state": () => ({
    key: (runs) => groupKeyOf(runs.Status) as Measure<Joined>,
    keeps: "non-empty",
  }),
};

const isEvaluation = (spec: MetricSpec) => spec.joins.includes(EVALUATIONS);

/** Which tables a query joins, or that this shape does not serve it. */
type JoinPlan = { kind: "refused" } | { kind: "joined"; tables: ReadonlySet<string> };
const REFUSED: JoinPlan = { kind: "refused" };

/** A series this shape reads: no pipeline, no outer grouping, a row filter, joins it knows. */
function servesSeries(series: AnalyticsSeries, index: number): boolean {
  if (series.pipeline) return false;
  const spec = specOf(series, index);
  if (spec.outer) return false;
  if (spec.joins.some((join) => join !== SPANS && join !== EVALUATIONS)) return false;
  const filters = (series.filters ?? {}) as AnalyticsFilterInput;
  return filterTranslations({ filters, ts }).every((each) => each.kind === "row");
}

function planOf(input: TimeseriesQueryInput): JoinPlan {
  const numeric = typeof input.timeScale === "number";
  if (!numeric && !(input.timeScale === "full" && input.groupBy)) return REFUSED;
  const runGrouped = input.groupBy !== undefined && RUN_GROUP_BYS[input.groupBy] !== undefined;
  if (input.groupBy && !runGrouped && !GROUP_BYS[input.groupBy]) return REFUSED;
  if (!input.series.every(servesSeries)) return REFUSED;
  const specs = input.series.map(specOf);
  // Main's mixed path takes run metrics beside any other metric (hasEvalMixedWithTraceMetrics).
  if (specs.some(isEvaluation) && !specs.every(isEvaluation)) return REFUSED;
  const tables = new Set([
    ...specs.flatMap((spec) => spec.joins),
    ...(runGrouped ? [EVALUATIONS] : []),
  ]);
  return tables.size > 0 ? { kind: "joined", tables } : REFUSED;
}

/**
 * Whether the joined shape serves this query, as main routed it to buildStandardTimeseriesQuery
 * with joins: a numeric scale, or full with a grouping; no pipeline; no span-row grouping.
 */
export function servesJoinedTraceSummaries(input: TimeseriesQueryInput): boolean {
  return planOf(input).kind === "joined";
}

/** Spans within main's StartTime envelope and the proof's windows; main elected no version. */
function spansOf(scope: ProofScope, input: TimeseriesQueryInput) {
  const from = param.epochMs(input.previousPeriodStartDate.getTime() - SPAN_MARGIN_MS);
  const until = param.epochMs(input.endDate.getTime() + SPAN_MARGIN_MS);
  return clickhouseRead({ scope })
    .from(ss)
    .withinWindows()
    .select({
      TenantId: ss.TenantId,
      TraceId: ss.TraceId,
      SpanAttributes: ss.SpanAttributes,
      eventNames: ss["Events.Name"],
      eventAttributes: ss["Events.Attributes"],
    })
    .where(({ and, gte, lt }) => and(gte(ss.StartTime, from), lt(ss.StartTime, until)))
    .as("spans");
}

type Spans = ReturnType<typeof spansOf>;

const SPAN_COLUMNS: Record<SpanMetricColumn, "SpanAttributes" | "eventNames" | "eventAttributes"> =
  {
    SpanAttributes: "SpanAttributes",
    "Events.Name": "eventNames",
    "Events.Attributes": "eventAttributes",
  };

function sourceOf({
  spans,
  runs,
}: {
  spans: Spans | undefined;
  runs: Runs | undefined;
}): MetricSource<Joined> {
  return {
    trace: (name) => ts[name],
    attribute: (key) => fn.mapGet(ts.Attributes, key),
    span: (name) => {
      if (!spans) throw new Error("This joined read joins no stored_spans.");
      return spans[SPAN_COLUMNS[name]] as Measure<Joined>;
    },
    evaluation: (name) => {
      if (!runs) throw new Error("This joined read joins no evaluation_runs.");
      return runs[name] as Measure<Joined>;
    },
  };
}

type Keeps = "non-empty" | "not-null" | "all";

/** The query's `group_key` over the joined rows, and which keys its HAVING keeps. */
function groupingOf(
  input: TimeseriesQueryInput,
  runs: Runs | undefined,
): { groupKey?: Measure<Joined>; keeps: Keeps } {
  if (!input.groupBy) return { keeps: "all" };
  const runGrouping = RUN_GROUP_BYS[input.groupBy]?.(input.groupByKey);
  if (runGrouping && runs) {
    return { groupKey: runGrouping.key(runs, input.groupByKey), keeps: runGrouping.keeps };
  }
  const grouping = GROUP_BYS[input.groupBy];
  if (!grouping) return { keeps: "all" };
  return { groupKey: groupKeyFor(grouping), keeps: grouping.handlesUnknown ? "all" : "non-empty" };
}

function seriesSelection(input: TimeseriesQueryInput, source: MetricSource<Joined>) {
  return Object.fromEntries(
    input.series.map((series, index): [string, Measure<Joined>] => {
      const spec = specOf(series, index);
      const conditions = seriesConditions(series) as Condition<Joined>[];
      return [
        seriesAlias(series, index),
        shapeSeries({
          series,
          when: conditions.length > 0 ? allOf(conditions) : undefined,
          render: (when) => renderMetric({ spec, source, when }),
        }),
      ];
    }),
  );
}

type Parts = {
  input: TimeseriesQueryInput;
  settings: TimeseriesRead["settings"];
  selection: Record<string, Measure>;
  keys: Measure[];
  groupKey: Measure | undefined;
  keeps: Keeps;
};

/** The period filter, the dashboard's filters, the election, grouping, HAVING and order. */
function finish<T extends string>(
  read: ClickHouseRead<
    ProofScope,
    T | "trace_summaries",
    Record<never, never>,
    Record<never, never>
  >,
  { input, settings, selection, keys, groupKey, keeps }: Parts,
): ReaderReadStatement {
  type Read = T | "trace_summaries";
  // The parts read only the tables this read joined; the branch that built it chose them.
  const key = groupKey as Measure<Read> | undefined;
  const { filters, restrictions } = filtersOf(input);
  const grouped = read
    .select(selection as Record<string, Measure<Read>>)
    .where(() => inEitherPeriod(ts.OccurredAt, input))
    .where((ops) => allOf([filters(ops), ...restrictions]), { inElection: false })
    .latestVersion()
    .groupBy(...(keys as Measure<Read>[]));
  const having = (): typeof grouped => {
    if (!key || keeps === "all") return grouped;
    if (keeps === "not-null") return grouped.having(() => cond.isNotNull(key));
    return grouped.having(({ ne }) => ne(key, param.string("")));
  };
  const ordered = having().orderBy("period");
  return (typeof input.timeScale === "number" ? ordered.orderBy("date") : ordered)
    .settings({ ...settings, log_comment: "analytics:timeseries:trace_summaries:joined" })
    .build() as ReaderReadStatement;
}

/** The joined trace_summaries timeseries read; see {@link servesJoinedTraceSummaries}. */
export function joinedTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  const plan = planOf(input);
  const tables = plan.kind === "joined" ? plan.tables : new Set<string>();
  const spans = tables.has(SPANS) ? spansOf(scope, input) : undefined;
  const runs = tables.has(EVALUATIONS) ? runsOf(scope, input) : undefined;

  const selection: Record<string, Measure> = { period: periodOf(ts.OccurredAt, input) };
  const date =
    typeof input.timeScale === "number"
      ? dateBucket(ts.OccurredAt, input.timeScale, input.timeZone ?? "UTC")
      : undefined;
  if (date) selection.date = date;
  const { groupKey, keeps } = groupingOf(input, runs);
  if (groupKey) selection.group_key = groupKey;
  Object.assign(selection, seriesSelection(input, sourceOf({ spans, runs })));
  const keys = [selection.period!, ...(date ? [date] : []), ...(groupKey ? [groupKey] : [])];
  const parts: Parts = { input, settings, selection, keys, groupKey, keeps };

  const base = clickhouseRead({ scope }).from(ts).withinWindows();
  if (spans && runs) {
    return finish(
      base
        .innerJoin(spans, ({ and, eq }) =>
          and(eq(spans.TenantId, ts.TenantId), eq(spans.TraceId, ts.TraceId)),
        )
        .innerJoin(runs, ({ and, eq }) =>
          and(eq(runs.TenantId, ts.TenantId), eq(runs.TraceId, ts.TraceId)),
        ),
      parts,
    );
  }
  if (spans) {
    return finish(
      base.innerJoin(spans, ({ and, eq }) =>
        and(eq(spans.TenantId, ts.TenantId), eq(spans.TraceId, ts.TraceId)),
      ),
      parts,
    );
  }
  if (runs) {
    return finish(
      base.innerJoin(runs, ({ and, eq }) =>
        and(eq(runs.TenantId, ts.TenantId), eq(runs.TraceId, ts.TraceId)),
      ),
      parts,
    );
  }
  return finish(base, parts);
}

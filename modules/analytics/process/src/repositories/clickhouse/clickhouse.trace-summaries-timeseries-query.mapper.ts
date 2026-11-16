/**
 * The standard `trace_summaries` timeseries read on the typed builder (ADR-202): trace-row metrics
 * over each trace's latest version, by date and a trace column, or as the both-periods summary.
 * Joins and pipelines stay on the text path.
 */

import { isZeroWhenAbsentSeries, type AnalyticsSeries } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  type ClickHouseReadStart,
  type Condition,
  cond,
  fn,
  param,
  type ProofScope,
  type ReadOps,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import {
  type AnalyticsFilterInput,
  analyticsFilterCondition,
  filterTranslations,
  type SpanWindow,
} from "./clickhouse.filter-conditions.mapper.ts";
import {
  type MetricSource,
  type MetricSpec,
  metricSpecFor,
  renderMetric,
  shapeSeries,
} from "./clickhouse.metric-spec.mapper.ts";
import { buildMetricAlias } from "./clickhouse.metric-translator.mapper.ts";
import {
  allOf,
  currentPeriod,
  dateBucket,
  groupKeyOf,
  inEitherPeriod,
  type Measure,
  periodOf,
  previousPeriod,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";

type Summaries = "trace_summaries";

/** The trace columns this shape groups by; each says whether it answers for its own empty value. */
export const GROUP_BYS: Record<string, { key: Measure<Summaries>; handlesUnknown: boolean }> = {
  "topics.topics": { key: ts.TopicId, handlesUnknown: false },
  "traces.trace_name": {
    key: fn.if(cond.eq(ts.TraceName, ""), param.string("unknown"), ts.TraceName),
    handlesUnknown: true,
  },
  "metadata.user_id": { key: fn.mapGet(ts.Attributes, "langwatch.user_id"), handlesUnknown: false },
  "metadata.thread_id": {
    key: fn.mapGet(ts.Attributes, "gen_ai.conversation.id"),
    handlesUnknown: false,
  },
  "metadata.customer_id": {
    key: fn.mapGet(ts.Attributes, "langwatch.customer_id"),
    handlesUnknown: false,
  },
  // A trace-level fact, as the `traces.error` filter reads it.
  "error.has_error": {
    key: fn.if(ts.ContainsErrorStatus, param.string("with error"), param.string("without error")),
    handlesUnknown: true,
  },
};

const unjoined = (table: string) => (): never => {
  throw new Error(`The standard trace_summaries read joins no ${table}.`);
};

/** A metric's columns on the elected trace row. */
const SOURCE: MetricSource<Summaries> = {
  trace: (name) => ts[name],
  attribute: (key) => fn.mapGet(ts.Attributes, key),
  span: unjoined("stored_spans"),
  evaluation: unjoined("evaluation_runs"),
};

export function specOf(series: AnalyticsSeries, index: number): MetricSpec {
  return metricSpecFor({
    metric: series.metric,
    aggregation: series.aggregation,
    index,
    key: series.key,
    subkey: series.subkey,
  });
}

/** The span scan's bounds for a side-table filter: both periods, as main's subqueries pruned. */
export function spanWindowOf(input: TimeseriesQueryInput): SpanWindow {
  return { startMs: input.previousPeriodStartDate.getTime(), endMs: input.endDate.getTime() };
}

/** What a read's clause operations look like to a series filter: a side table is a subquery. */
export type SeriesOps<Tables extends string, Ctes extends Record<string, unknown>> = ReadOps<
  ProofScope,
  Tables | Summaries,
  Ctes
>;

/**
 * A series' own filters as conditions (none when it has none). A side-table filter is main's
 * `(TenantId, TraceId) IN (...)`, a subquery in the proof's windows, inside the series' `-If`.
 */
export function seriesConditions<Tables extends string, Ctes extends Record<string, unknown>>({
  series,
  input,
  ops,
}: {
  series: AnalyticsSeries;
  input: TimeseriesQueryInput;
  ops: SeriesOps<Tables, Ctes>;
}): Condition<Summaries>[] {
  if (!hasSeriesFilter(series)) return [];
  const filters = (series.filters ?? {}) as AnalyticsFilterInput;
  const condition = analyticsFilterCondition({ filters, ts, spanWindow: spanWindowOf(input) });
  // Every term reads the summaries alias or a subquery of its own.
  return [condition(ops) as Condition<Summaries>];
}

/** Whether a series has a filter of its own (an entry the composer keeps empty does not count). */
export function hasSeriesFilter(series: AnalyticsSeries): boolean {
  const filters = (series.filters ?? {}) as AnalyticsFilterInput;
  return filterTranslations({ filters, ts }).length > 0;
}

/**
 * Whether the standard shape serves this query, as main's buildTimeseriesQuery routed it: no
 * pipeline, every metric on the trace row alone.
 */
export function servesStandardTraceSummaries(input: TimeseriesQueryInput): boolean {
  if (typeof input.timeScale !== "number" && input.timeScale !== "full") return false;
  if (input.groupBy && !GROUP_BYS[input.groupBy]) return false;
  return input.series.every((series, index) => {
    if (series.pipeline) return false;
    const spec = specOf(series, index);
    return spec.joins.length === 0 && !spec.outer && spec.form === "scalar";
  });
}

/** A series' measure on the elected trace row, under its own filter and percentage mode. */
function seriesMeasure<Tables extends string, Ctes extends Record<string, unknown>>({
  series,
  index,
  input,
  ops,
}: {
  series: AnalyticsSeries;
  index: number;
  input: TimeseriesQueryInput;
  ops: SeriesOps<Tables, Ctes>;
}): Measure<Summaries> {
  const spec = specOf(series, index);
  const conditions = seriesConditions({ series, input, ops });
  return shapeSeries({
    series,
    when: conditions.length > 0 ? allOf(conditions) : undefined,
    render: (when) => renderMetric({ spec, source: SOURCE, when }),
  });
}

/** A grouping's `group_key`: its own expression when it answers for its empty value. */
export function groupKeyFor(grouping: {
  key: Measure<Summaries>;
  handlesUnknown: boolean;
}): Measure<Summaries> {
  return grouping.handlesUnknown ? grouping.key : groupKeyOf(grouping.key);
}

/** The trace scope and the origin exclusion: outside the negate toggle. */
function restrictionsOf(input: TimeseriesQueryInput): Condition<Summaries>[] {
  const restrictions: Condition<Summaries>[] = [];
  if (input.traceIds && input.traceIds.length > 0) {
    restrictions.push(cond.oneOf(ts.TraceId, input.traceIds));
  }
  if (input.excludeOrigins && input.excludeOrigins.length > 0) {
    restrictions.push(
      cond.not(cond.oneOf(fn.mapGet(ts.Attributes, "langwatch.origin"), input.excludeOrigins)),
    );
  }
  return restrictions;
}

/** Each series' alias and measure, in the order the dashboard asked them. */
function seriesSelection<Tables extends string, Ctes extends Record<string, unknown>>(
  input: TimeseriesQueryInput,
  ops: SeriesOps<Tables, Ctes>,
): [string, Measure<Summaries>][] {
  return input.series.map((series, index) => [
    seriesAlias(series, index),
    seriesMeasure({ series, index, input, ops }),
  ]);
}

/** A series' result key, as the row parser reads it. */
export function seriesAlias(series: AnalyticsSeries, index: number): string {
  return buildMetricAlias({
    index,
    metric: series.metric,
    aggregation: series.aggregation,
    key: series.key,
    subkey: series.subkey,
  });
}

/** The dashboard's filters, under the negate toggle, and the restrictions outside it. */
export function filtersOf(input: TimeseriesQueryInput): {
  filters: <Tables extends string, Ctes extends Record<string, unknown>>(
    ops: ReadOps<ProofScope, Tables | Summaries, Ctes>,
  ) => Condition<Tables | Summaries>;
  restrictions: Condition<Summaries>[];
} {
  const restrictions = restrictionsOf(input);
  const filters = analyticsFilterCondition({
    filters: (input.filters ?? {}) as AnalyticsFilterInput,
    ts,
    spanWindow: spanWindowOf(input),
    negated: input.negateFilters === true,
  });
  return { filters, restrictions };
}

/**
 * The both-periods summary (full scale, no grouping), as main's scalar-subquery UNION: one
 * aggregate row per period even when the period is empty, additive series coalesced to 0.
 */
function summaryRead({ scope, input, settings }: TimeseriesRead): ReaderReadStatement {
  const aliases = input.series.map(seriesAlias);
  const { filters, restrictions } = filtersOf(input);
  const selectionOf =
    (period: "current" | "previous") =>
    <Ctes extends Record<string, unknown>>(
      ops: SeriesOps<Summaries, Ctes>,
    ): Record<string, Measure<Summaries>> => ({
      period: param.string(period),
      ...Object.fromEntries(
        seriesSelection(input, ops).map(([alias, measure], index): [string, Measure<Summaries>] => [
          alias,
          isZeroWhenAbsentSeries(input.series[index]!)
            ? fn.coalesce(measure, param.uint32(0))
            : measure,
        ]),
      ),
    });
  const arm = (start: ClickHouseReadStart<ProofScope>, period: "current" | "previous") =>
    start
      .from(ts)
      .withinWindows()
      .select(selectionOf(period))
      .where(() =>
        period === "current"
          ? currentPeriod(ts.OccurredAt, input)
          : previousPeriod(ts.OccurredAt, input),
      )
      .where((ops) => allOf([filters(ops), ...restrictions]), { inElection: false })
      .latestVersion();
  const periods = arm(clickhouseRead({ scope }), "current")
    .unionAll((start) => arm(start, "previous"))
    .as("periods");
  const keys = ["period", ...aliases];
  return clickhouseRead({ scope })
    .from(periods)
    .select(Object.fromEntries(keys.map((key) => [key, periods[key]!])))
    .settings({ ...settings, log_comment: "analytics:timeseries:trace_summaries" })
    .build() as ReaderReadStatement;
}

/** The standard trace_summaries timeseries read; see {@link servesStandardTraceSummaries}. */
export function traceSummariesTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  if (input.timeScale === "full" && !input.groupBy) return summaryRead({ scope, input, settings });
  const selection: Record<string, Measure<Summaries>> = { period: periodOf(ts.OccurredAt, input) };
  const date =
    typeof input.timeScale === "number"
      ? dateBucket(ts.OccurredAt, input.timeScale, input.timeZone ?? "UTC")
      : undefined;
  if (date) selection.date = date;
  const grouping = input.groupBy ? GROUP_BYS[input.groupBy] : undefined;
  const groupKey = grouping ? groupKeyFor(grouping) : undefined;
  if (groupKey) selection.group_key = groupKey;

  const { filters, restrictions } = filtersOf(input);
  const keys = [selection.period!, ...(date ? [date] : []), ...(groupKey ? [groupKey] : [])];
  const grouped = clickhouseRead({ scope })
    .from(ts)
    .withinWindows()
    .select((ops) => ({ ...selection, ...Object.fromEntries(seriesSelection(input, ops)) }))
    .where(() => inEitherPeriod(ts.OccurredAt, input))
    .where((ops) => allOf([filters(ops), ...restrictions]), { inElection: false })
    .latestVersion()
    .groupBy(...keys);
  const having =
    groupKey && !grouping?.handlesUnknown
      ? grouped.having(({ ne }) => ne(groupKey, param.string("")))
      : grouped;
  const ordered = having.orderBy("period");
  return (date ? ordered.orderBy("date") : ordered)
    .settings({ ...settings, log_comment: "analytics:timeseries:trace_summaries" })
    .build() as ReaderReadStatement;
}

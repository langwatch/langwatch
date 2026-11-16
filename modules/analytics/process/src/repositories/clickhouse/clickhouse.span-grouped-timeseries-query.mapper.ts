/**
 * Trace metrics grouped by a key a trace holds several of (its labels, its spans' types, events
 * and votes) on the typed builder (ADR-202), as main's buildArrayJoinTimeseriesQuery: one row per
 * member's trace and key first, so a trace counts once in each of its keys, never once per span.
 */

import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  column,
  cond,
  type Expression,
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
import { type JoinedSpans, spansOf } from "./clickhouse.joined-timeseries-query.mapper.ts";
import type { MetricSource } from "./clickhouse.metric-spec.mapper.ts";
import { carriedPerTrace, measuresOver } from "./clickhouse.mixed-eval-timeseries-query.mapper.ts";
import {
  allOf,
  dateBucket,
  groupKeyOf,
  inEitherPeriod,
  type Measure,
  periodOf,
  type TimeseriesRead,
} from "./clickhouse.timeseries-query-shared.mapper.ts";
import { filtersOf, specOf } from "./clickhouse.trace-summaries-timeseries-query.mapper.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";

type Grouped = "trace_summaries" | "spans";

/**
 * A grouping main sent to its span-dedup path (aggregation-builder:706-794): its key over the
 * trace and its joined spans, whether it expands an array (so a filter on the field also keeps
 * only the filtered keys), and whether it answers for its own empty value.
 */
type SpanGrouping = {
  spans: boolean;
  expands: boolean;
  handlesUnknown: boolean;
  key: (spans: JoinedSpans | undefined) => Measure<Grouped>;
};

const joinedSpans = (spans: JoinedSpans | undefined): JoinedSpans => {
  if (!spans) throw new Error("This span-grouped read joins no stored_spans.");
  return spans;
};

type Votes = Expression<readonly Readonly<Record<string, string>>[], string>;
type Names = Expression<readonly string[], string>;

const SPAN_GROUP_BYS: Record<string, SpanGrouping> = {
  "metadata.labels": {
    spans: false,
    expands: true,
    handlesUnknown: false,
    key: () =>
      groupKeyOf(
        fn.arrayJoin(
          fn.JSONExtract(
            fn.mapGet(ts.Attributes, "langwatch.labels"),
            column.array(column.string()),
          ),
        ),
      ),
  },
  "metadata.span_type": {
    spans: true,
    expands: false,
    handlesUnknown: true,
    key: (spans) => {
      const type = fn.mapGet(joinedSpans(spans).SpanAttributes, "langwatch.span.type");
      return fn.if(
        cond.or(cond.eq(type, param.string("")), cond.isNull(type)),
        param.string("unknown"),
        type,
      ) as Measure<Grouped>;
    },
  },
  "events.event_type": {
    spans: true,
    expands: true,
    handlesUnknown: false,
    key: (spans) => groupKeyOf(fn.arrayJoin(joinedSpans(spans).eventNames)) as Measure<Grouped>,
  },
  "sentiment.thumbs_up_down": {
    spans: true,
    expands: true,
    handlesUnknown: false,
    key: (spans) => {
      const names = joinedSpans(spans).eventNames as Names;
      const attributes = joinedSpans(spans).eventAttributes as Votes;
      const voted = fn.arrayFilter(
        (a, n) => cond.and(cond.eq(n, "thumbs_up_down"), fn.mapContains(a, "event.metrics.vote")),
        attributes,
        names,
      );
      const vote = fn.arrayMap((a) => {
        const value = fn.toInt32OrNull(fn.mapGet(a, "event.metrics.vote"));
        return fn.multiIf(
          [
            [cond.eq(value, 1), param.string("Thumbs Up")],
            [cond.eq(value, -1), param.string("Thumbs Down")],
          ],
          param.string(""),
        );
      }, voted);
      return groupKeyOf(fn.arrayJoin(vote)) as Measure<Grouped>;
    },
  },
};

/** Per trace already, so main read these pipelines as their inner metric. */
const TRACE_ID_PIPELINES: ReadonlySet<string> = new Set(["sum", "avg", "min", "max"]);

/** A series this shape reads: a trace-row metric, a row filter, no pipeline but a per-trace one. */
function servesSeries(series: AnalyticsSeries, index: number): boolean {
  const { pipeline } = series;
  if (
    pipeline &&
    !(pipeline.field === "trace_id" && TRACE_ID_PIPELINES.has(pipeline.aggregation))
  ) {
    return false;
  }
  const spec = specOf(series, index);
  if (spec.joins.length > 0 || spec.outer || spec.form !== "scalar") return false;
  const filters = (series.filters ?? {}) as AnalyticsFilterInput;
  return filterTranslations({ filters, ts }).every((each) => each.kind === "row");
}

/**
 * Whether the span-grouped shape serves this query: a grouping main deduplicated per trace and
 * key, trace-row metrics only. Span, run and pipeline metrics under it stay on the text path.
 */
export function servesSpanGrouped(input: TimeseriesQueryInput): boolean {
  if (typeof input.timeScale !== "number" && input.timeScale !== "full") return false;
  if (!input.groupBy || !SPAN_GROUP_BYS[input.groupBy]) return false;
  return input.series.every(servesSeries);
}

/** One row per member's trace, period, date and key, each metric's columns carried with `any`. */
function perTraceRead({
  scope,
  input,
  grouping,
}: {
  scope: ProofScope;
  input: TimeseriesQueryInput;
  grouping: SpanGrouping;
}) {
  const spans = grouping.spans ? spansOf(scope, input) : undefined;
  const source: MetricSource<Grouped> = {
    trace: (name) => ts[name],
    attribute: (key) => fn.mapGet(ts.Attributes, key),
    span: () => {
      throw new Error("The span-grouped read carries trace-row metrics only.");
    },
    evaluation: () => {
      throw new Error("The span-grouped read carries trace-row metrics only.");
    },
  };
  const groupKey = grouping.key(spans);
  const selection: Record<string, Measure<Grouped>> = {
    TenantId: ts.TenantId,
    trace_id: ts.TraceId,
    period: periodOf(ts.OccurredAt, input),
  };
  const groupBy: Measure<Grouped>[] = [ts.TenantId, ts.TraceId, selection.period!];
  if (typeof input.timeScale === "number") {
    selection.date = dateBucket(ts.OccurredAt, input.timeScale, input.timeZone ?? "UTC");
    groupBy.push(selection.date);
  }
  selection.group_key = groupKey;
  groupBy.push(groupKey);
  Object.assign(selection, carriedPerTrace({ input, source }));

  const { filters, restrictions } = filtersOf(input);
  const base = clickhouseRead({ scope }).from(ts).withinWindows();
  const joined = spans
    ? base.innerJoin(spans, ({ and, eq }) =>
        and(eq(spans.TenantId, ts.TenantId), eq(spans.TraceId, ts.TraceId)),
      )
    : base;
  return (joined as typeof base)
    .select(selection as Record<string, Measure<"trace_summaries">>)
    .where(() => inEitherPeriod(ts.OccurredAt, input))
    .where((ops) => allOf([filters(ops), ...restrictions]), { inElection: false })
    .latestVersion()
    .groupBy(...(groupBy as Measure<"trace_summaries">[]))
    .as("per_trace");
}

/** The dashboard's values for the grouped field, when the grouping expands an array. */
function keptKeys(input: TimeseriesQueryInput, grouping: SpanGrouping): string[] {
  if (!grouping.expands || !input.groupBy || !input.filters) return [];
  const values = input.filters[input.groupBy as keyof typeof input.filters];
  return Array.isArray(values) ? values : [];
}

/** The span-grouped trace_summaries timeseries read; see {@link servesSpanGrouped}. */
export function spanGroupedTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  const grouping = SPAN_GROUP_BYS[input.groupBy ?? ""];
  if (!grouping) throw new Error(`No span grouping for ${input.groupBy ?? "nothing"}.`);
  const perTrace = perTraceRead({ scope, input, grouping });
  const dated = typeof input.timeScale === "number";
  const groupKey = perTrace.group_key!;
  const selection: Record<string, Measure> = { period: perTrace.period! };
  if (dated) selection.date = perTrace.date!;
  selection.group_key = groupKey;
  Object.assign(selection, measuresOver(input, perTrace));
  const keys = [perTrace.period!, ...(dated ? [perTrace.date!] : []), groupKey];
  const kept = keptKeys(input, grouping);
  const read = clickhouseRead({ scope })
    .from(perTrace)
    .select(selection as Record<string, Measure<"per_trace">>);
  const grouped = (kept.length > 0 ? read.where(() => cond.oneOf(groupKey, kept)) : read).groupBy(
    ...keys,
  );
  const having = grouping.handlesUnknown
    ? grouped
    : grouped.having(() => cond.ne(groupKey, param.string("")));
  const ordered = having.orderBy("period");
  return (dated ? ordered.orderBy("date") : ordered)
    .settings({ ...settings, log_comment: "analytics:timeseries:trace_summaries:span_grouped" })
    .build() as ReaderReadStatement;
}

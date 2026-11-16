/**
 * Trace metrics grouped by a key a trace holds several of (its labels, its spans' types, events
 * votes and span models) on the typed builder (ADR-202), as main's buildArrayJoinTimeseriesQuery:
 * one row per member's trace and key first, so a trace counts once in each key, never per span.
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
  type ReadOps,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import { spansOf } from "./clickhouse.joined-timeseries-query.mapper.ts";
import type { MetricSource } from "./clickhouse.metric-spec.mapper.ts";
import { carriedPerTrace, measuresOver } from "./clickhouse.mixed-eval-timeseries-query.mapper.ts";
import {
  type ModelBuckets,
  modelBucketsOf,
  modelKeyOf,
  partitionedSource,
  SPAN_MODEL_PARTITION_SETTINGS,
} from "./clickhouse.span-model-partition.mapper.ts";
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

type Grouped = "trace_summaries" | "spans" | "smd";

/** The span columns a grouping's key reads: one span's, or one event's as one-element arrays. */
export type SpanView = {
  SpanAttributes: Measure;
  eventNames: Measure;
  eventAttributes: Measure;
};

/** What a grouping joins to the trace: nothing, its spans, or its span-model buckets. */
type Joined = { spans?: SpanView; models?: ModelBuckets };

/**
 * A grouping main sent to its span-dedup path (aggregation-builder:706-794): its key over the
 * trace and what it joins, whether it expands an array (so a filter on the field also keeps
 * only the filtered keys), and whether it answers for its own empty value.
 */
export type SpanGrouping = {
  joins: "none" | "spans" | "models";
  expands: boolean;
  handlesUnknown: boolean;
  /** `distinct`: each key once per span, where a span holds several. */
  key: (joined: Joined, distinct?: boolean) => Measure<Grouped>;
};

const joinedSpans = ({ spans }: Joined): SpanView => {
  if (!spans) throw new Error("This span-grouped read joins no stored_spans.");
  return spans;
};

const joinedModels = ({ models }: Joined): ModelBuckets => {
  if (!models) throw new Error("This span-grouped read joins no span-model buckets.");
  return models;
};

type Votes = Expression<readonly Readonly<Record<string, string>>[], string>;
type Names = Expression<readonly string[], string>;

const SPAN_GROUP_BYS: Record<string, SpanGrouping> = {
  "metadata.labels": {
    joins: "none",
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
    joins: "spans",
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
    joins: "spans",
    expands: true,
    handlesUnknown: false,
    key: (spans, distinct) => {
      const names = joinedSpans(spans).eventNames as Names;
      return groupKeyOf(
        fn.arrayJoin(distinct ? fn.arrayDistinct(names) : names),
      ) as Measure<Grouped>;
    },
  },
  "sentiment.thumbs_up_down": {
    joins: "spans",
    expands: true,
    handlesUnknown: false,
    key: (spans, distinct) => {
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
      return groupKeyOf(fn.arrayJoin(distinct ? fn.arrayDistinct(vote) : vote)) as Measure<Grouped>;
    },
  },
  "metadata.model": {
    joins: "models",
    expands: false,
    handlesUnknown: true,
    key: (joined) => modelKeyOf(joinedModels(joined)) as Measure<Grouped>,
  },
};

/** Whether `groupBy` is a grouping main deduplicated per trace and key. */
export function isSpanGrouping(groupBy: string | undefined): boolean {
  return groupBy !== undefined && SPAN_GROUP_BYS[groupBy] !== undefined;
}

/** The span grouping `groupBy` names; see {@link isSpanGrouping}. */
export function getSpanGrouping(groupBy: string | undefined): SpanGrouping {
  const grouping = groupBy ? SPAN_GROUP_BYS[groupBy] : undefined;
  if (!grouping) throw new Error(`No span grouping for ${groupBy ?? "nothing"}.`);
  return grouping;
}

/** Per trace already, so main read these pipelines as their inner metric. */
const TRACE_ID_PIPELINES: ReadonlySet<string> = new Set(["sum", "avg", "min", "max"]);

/** A series this shape reads: a trace-row metric, no pipeline but a per-trace one. */
export function servesSpanGroupedSeries(series: AnalyticsSeries, index: number): boolean {
  const { pipeline } = series;
  if (
    pipeline &&
    !(pipeline.field === "trace_id" && TRACE_ID_PIPELINES.has(pipeline.aggregation))
  ) {
    return false;
  }
  const spec = specOf(series, index);
  return spec.joins.length === 0 && !spec.outer && spec.form === "scalar";
}

/**
 * Whether the span-grouped shape serves this query: a grouping main deduplicated per trace and
 * key, trace-row metrics only. Span, run and pipeline metrics under it stay on the text path.
 */
export function servesSpanGrouped(input: TimeseriesQueryInput): boolean {
  if (typeof input.timeScale !== "number" && input.timeScale !== "full") return false;
  if (!input.groupBy || !SPAN_GROUP_BYS[input.groupBy]) return false;
  return input.series.every(servesSpanGroupedSeries);
}

/** Carries, per trace, what the outer read aggregates: by default each metric's columns. */
type Carry = (input: {
  input: TimeseriesQueryInput;
  source: MetricSource<Grouped>;
  ops: ReadOps<ProofScope, "trace_summaries", Record<never, never>>;
}) => Record<string, Measure<Grouped>>;

/** One row per member's trace, period, date and key, each metric's columns carried with `any`. */
function perTraceRead({
  scope,
  input,
  grouping,
  carry,
}: {
  scope: ProofScope;
  input: TimeseriesQueryInput;
  grouping: SpanGrouping;
  carry?: Carry;
}) {
  const spans = grouping.joins === "spans" ? spansOf(scope, input) : undefined;
  const models = grouping.joins === "models" ? modelBucketsOf(scope, input) : undefined;
  const joined: Joined = { spans: spans as SpanView | undefined, models };
  const source: MetricSource<Grouped> = models
    ? (partitionedSource(models) as MetricSource<Grouped>)
    : {
        trace: (name) => ts[name],
        attribute: (key) => fn.mapGet(ts.Attributes, key),
        span: () => {
          throw new Error("The span-grouped read carries trace-row metrics only.");
        },
        evaluation: () => {
          throw new Error("The span-grouped read carries trace-row metrics only.");
        },
      };
  const groupKey = grouping.key(joined);
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

  const { filters, restrictions } = filtersOf(input);
  const base = clickhouseRead({ scope }).from(ts).withinWindows();
  const withSpans = spans
    ? base.innerJoin(spans, ({ and, eq }) =>
        and(eq(spans.TenantId, ts.TenantId), eq(spans.TraceId, ts.TraceId)),
      )
    : base;
  const withModels = models
    ? withSpans.leftJoin(models, ({ and, eq }) =>
        and(eq(models.TenantId!, ts.TenantId), eq(models.TraceId!, ts.TraceId)),
      )
    : withSpans;
  return (withModels as typeof base)
    .select(
      (ops) =>
        ({ ...selection, ...(carry ?? carriedPerTrace)({ input, source, ops }) }) as Record<
          string,
          Measure<"trace_summaries">
        >,
    )
    .where(() => inEitherPeriod(ts.OccurredAt, input))
    .where((ops) => allOf([filters(ops), ...restrictions]), { inElection: false })
    .latestVersion()
    .groupBy(...(groupBy as Measure<"trace_summaries">[]))
    .as("per_trace");
}

/** The per-trace rows as a derived table, for the span-grouped span, run and pipeline reads. */
export type PerTraceRows = ReturnType<typeof perTraceRead>;

export function perTraceRowsOf(read: Parameters<typeof perTraceRead>[0]): PerTraceRows {
  return perTraceRead(read);
}

/** The dashboard's values for the grouped field, when the grouping expands an array. */
export function keptKeys(input: TimeseriesQueryInput, grouping: SpanGrouping): string[] {
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
    .settings({
      ...(grouping.joins === "models" ? SPAN_MODEL_PARTITION_SETTINGS : {}),
      ...settings,
      log_comment: "analytics:timeseries:trace_summaries:span_grouped",
    })
    .build() as ReaderReadStatement;
}

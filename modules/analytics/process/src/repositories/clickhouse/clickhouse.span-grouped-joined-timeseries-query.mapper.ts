/**
 * Span and run metrics under a span grouping on the typed builder (ADR-202), by Alex's rulings of
 * 2026-11-16: 3a and 5a, a span metric reads only the spans or events behind each key, under its
 * own condition; 4a, a run metric is computed per run; 1a, a pipeline main dropped is computed.
 */

import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  type Condition,
  cond,
  type Expression,
  fn,
  param,
  type ProofScope,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import { inSpanEnvelope } from "./clickhouse.joined-timeseries-query.mapper.ts";
import {
  type MetricOperand,
  type MetricPredicate,
  type MetricSource,
  type MetricSpec,
  renderMetric,
  shapeSeries,
  type SpanMetricColumn,
} from "./clickhouse.metric-spec.mapper.ts";
import { runsOf } from "./clickhouse.mixed-eval-timeseries-query.mapper.ts";
import { pipelineSpecOf } from "./clickhouse.pipeline-timeseries-query.mapper.ts";
import {
  keptKeys,
  type PerTraceRows,
  perTraceRowsOf,
  type SpanGrouping,
  getSpanGrouping,
  isSpanGrouping,
  type SpanView,
  servesSpanGroupedSeries,
} from "./clickhouse.span-grouped-timeseries-query.mapper.ts";
import { modelOfSpan } from "./clickhouse.span-model-partition.mapper.ts";
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
  seriesAlias,
  seriesConditions,
  specOf,
} from "./clickhouse.trace-summaries-timeseries-query.mapper.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";

const SPANS = "stored_spans";
const EVALUATIONS = "evaluation_runs";
const MODEL = "metadata.model";
/** Groupings keyed by a span's events: an event metric there reads one event per row. */
const EVENT_GROUPINGS: ReadonlySet<string> = new Set([
  "events.event_type",
  "sentiment.thumbs_up_down",
]);

/** Which read a series takes under a span grouping; `other` has none. */
type SpanGroupedPart =
  | "trace"
  | "spans:scalar"
  | "spans:array"
  | "runs"
  | `pipeline:${number}`
  | "other";

/** A pipeline over one trace-row metric per entity: what the pipeline read below serves. */
function perEntityOf(series: AnalyticsSeries, index: number) {
  if (!series.pipeline) return undefined;
  const spec = pipelineSpecOf(series, index);
  if (spec.outer?.kind !== "per-entity" || spec.joins.length > 0 || spec.form !== "scalar") {
    return undefined;
  }
  return { spec, outer: spec.outer };
}

/** Which read a series takes; each pipeline its own, as its entities are its own. */
export function spanGroupedPartOf(series: AnalyticsSeries, index: number): SpanGroupedPart {
  if (servesSpanGroupedSeries(series, index)) return "trace";
  if (series.pipeline) return perEntityOf(series, index) ? `pipeline:${index}` : "other";
  const spec = specOf(series, index);
  if (spec.outer || spec.joins.length !== 1) return "other";
  if (spec.joins[0] === EVALUATIONS) return "runs";
  if (spec.joins[0] === SPANS) return spec.form === "array" ? "spans:array" : "spans:scalar";
  return "other";
}

function servesEvery(input: TimeseriesQueryInput, parts: readonly SpanGroupedPart[]): boolean {
  if (typeof input.timeScale !== "number" && input.timeScale !== "full") return false;
  if (!isSpanGrouping(input.groupBy)) return false;
  const [first, ...rest] = input.series.map(spanGroupedPartOf);
  return !!first && parts.includes(first) && rest.every((part) => part === first);
}

/** Span metrics of one form under a span grouping; see {@link spanGroupedSpansTimeseriesRead}. */
export function servesSpanGroupedSpans(input: TimeseriesQueryInput): boolean {
  return servesEvery(input, ["spans:scalar", "spans:array"]);
}

/** One pipeline under a span grouping; see {@link spanGroupedPipelineTimeseriesRead}. */
export function servesSpanGroupedPipeline(input: TimeseriesQueryInput): boolean {
  if (typeof input.timeScale !== "number" && input.timeScale !== "full") return false;
  if (!isSpanGrouping(input.groupBy) || input.series.length !== 1) return false;
  return perEntityOf(input.series[0]!, 0) !== undefined;
}

/** Run metrics under a span grouping; see {@link spanGroupedRunsTimeseriesRead}. */
export function servesSpanGroupedRuns(input: TimeseriesQueryInput): boolean {
  return servesEvery(input, ["runs"]);
}

/** Each span in main's StartTime envelope and the proof's windows, or each of its events. */
function unitsRead(scope: ProofScope, input: TimeseriesQueryInput, perEvent: boolean) {
  // Read per span, the index is a constant the view never reads.
  const eventIndex = perEvent
    ? fn.arrayJoin(fn.arrayEnumerate(ss["Events.Name"]))
    : param.uint32(0);
  return clickhouseRead({ scope })
    .from(ss)
    .withinWindows()
    .select({
      TenantId: ss.TenantId,
      TraceId: ss.TraceId,
      SpanAttributes: ss.SpanAttributes,
      SpanModel: modelOfSpan,
      eventNames: ss["Events.Name"],
      eventAttributes: ss["Events.Attributes"],
      eventIndex,
    })
    .where(() => inSpanEnvelope(input))
    .as("units");
}

type Units = ReturnType<typeof unitsRead>;

function viewOf(units: Units, perEvent: boolean): SpanView {
  if (!perEvent) {
    return {
      SpanAttributes: units.SpanAttributes!,
      eventNames: units.eventNames!,
      eventAttributes: units.eventAttributes!,
    };
  }
  // The row's one event, as the arrays it came from: a lambda's parameters keep their types.
  const only = (of: Measure) =>
    fn.arrayFilter(
      (_item, position) => cond.eq(position, units.eventIndex!),
      of as Expression<readonly unknown[], string>,
      fn.arrayEnumerate(of as Expression<readonly unknown[], string>),
    ) as Measure;
  return {
    SpanAttributes: units.SpanAttributes!,
    eventNames: only(units.eventNames!),
    eventAttributes: only(units.eventAttributes!),
  };
}

const VIEW_COLUMNS: Record<SpanMetricColumn, keyof SpanView> = {
  SpanAttributes: "SpanAttributes",
  "Events.Name": "eventNames",
  "Events.Attributes": "eventAttributes",
};

/** HAVING: no empty key where the grouping has no `unknown`, and the dashboard's kept keys. */
function keyKept(
  input: TimeseriesQueryInput,
  grouping: SpanGrouping,
  groupKey: Measure,
): Condition<string>[] {
  const kept = keptKeys(input, grouping);
  return [
    ...(grouping.handlesUnknown ? [] : [cond.ne(groupKey, param.string(""))]),
    ...(kept.length > 0 ? [cond.oneOf(groupKey, kept)] : []),
  ];
}

/**
 * Span metrics by a span grouping, one row per span behind each key (ruling 5a), or per event
 * when every metric reads events and the key is an event's: a metric's own condition holds per
 * span or event (3a). A trace-level key (labels) keeps every span of the trace.
 */
export function spanGroupedSpansTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  const grouping = getSpanGrouping(input.groupBy);
  const perEvent =
    EVENT_GROUPINGS.has(input.groupBy ?? "") &&
    input.series.every((series, index) => spanGroupedPartOf(series, index) === "spans:array");
  const units = unitsRead(scope, input, perEvent);
  const view = viewOf(units, perEvent);
  const groupKey =
    input.groupBy === MODEL
      ? (groupKeyOf(units.SpanModel!) as Measure)
      : (grouping.key({ spans: view }, !perEvent) as Measure);
  const source: MetricSource<string> = {
    trace: (name) => ts[name],
    attribute: (key) => fn.mapGet(ts.Attributes, key),
    span: (name) => view[VIEW_COLUMNS[name]],
    evaluation: () => {
      throw new Error("The span-grouped span read joins no evaluation_runs.");
    },
  };
  const dated = typeof input.timeScale === "number";
  const selection: Record<string, Measure> = { period: periodOf(ts.OccurredAt, input) };
  if (dated) {
    selection.date = dateBucket(ts.OccurredAt, input.timeScale as number, input.timeZone ?? "UTC");
  }
  selection.group_key = groupKey;
  const keys = [selection.period!, ...(dated ? [selection.date!] : []), groupKey];
  const { filters, restrictions } = filtersOf(input);
  const grouped = clickhouseRead({ scope })
    .from(ts)
    .withinWindows()
    .innerJoin(units, ({ and, eq }) =>
      and(eq(units.TenantId!, ts.TenantId), eq(units.TraceId!, ts.TraceId)),
    )
    .select((ops) => {
      const measures = input.series.map((series, index): [string, Measure] => {
        const conditions = seriesConditions({ series, input, ops }) as Condition<string>[];
        return [
          seriesAlias(series, index),
          shapeSeries({
            series,
            when: conditions.length > 0 ? allOf(conditions) : undefined,
            render: (when) => renderMetric({ spec: specOf(series, index), source, when }),
          }),
        ];
      });
      return { ...selection, ...Object.fromEntries(measures) } as Record<
        string,
        Measure<"trace_summaries">
      >;
    })
    .where(() => inEitherPeriod(ts.OccurredAt, input))
    .where((ops) => allOf([filters(ops), ...restrictions]), { inElection: false })
    .latestVersion()
    .groupBy(...(keys as Measure<"trace_summaries">[]));
  const kept = keyKept(input, grouping, groupKey);
  const having = kept.length > 0 ? grouped.having(() => allOf(kept) as never) : grouped;
  const ordered = having.orderBy("period");
  return (dated ? ordered.orderBy("date") : ordered)
    .settings({
      ...settings,
      log_comment: "analytics:timeseries:trace_summaries:span_grouped_spans",
    })
    .build() as ReaderReadStatement;
}

/**
 * Run metrics by a span grouping (ruling 4a): each member's trace once per period, date and key,
 * joined to its runs and aggregated per run, so the answer is the same alone or beside others.
 */
export function spanGroupedRunsTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  const grouping = getSpanGrouping(input.groupBy);
  const perTrace = perTraceRowsOf({
    scope,
    input,
    grouping,
    carry: ({ input: carried, ops }) => {
      const filtered: Record<string, Measure> = {};
      for (const [index, series] of carried.series.entries()) {
        const conditions = seriesConditions({ series, input: carried, ops });
        if (conditions.length > 0) filtered[`f${index}`] = fn.any(allOf(conditions));
      }
      return filtered as Record<string, Measure<"trace_summaries">>;
    },
  });
  const runs = runsOf(scope, input);
  const source: MetricSource<string> = {
    trace: () => {
      throw new Error("The span-grouped run read reads its runs only.");
    },
    attribute: () => {
      throw new Error("The span-grouped run read reads its runs only.");
    },
    span: () => {
      throw new Error("The span-grouped run read joins no stored_spans.");
    },
    evaluation: (name) => runs[name] as Measure,
  };
  const dated = typeof input.timeScale === "number";
  const groupKey = perTrace.group_key!;
  const selection: Record<string, Measure> = { period: perTrace.period! };
  if (dated) selection.date = perTrace.date!;
  selection.group_key = groupKey;
  for (const [index, series] of input.series.entries()) {
    selection[seriesAlias(series, index)] = shapeSeries({
      series,
      when: perTrace[`f${index}`] as Condition<string> | undefined,
      render: (when) => renderMetric({ spec: specOf(series, index), source, when }),
    });
  }
  const keys = [perTrace.period!, ...(dated ? [perTrace.date!] : []), groupKey];
  const grouped = clickhouseRead({ scope })
    .from(perTrace)
    .innerJoin(runs, ({ and, eq }) =>
      and(eq(runs.TenantId, perTrace.TenantId!), eq(runs.TraceId, perTrace.trace_id!)),
    )
    .select(selection as Record<string, Measure<"per_trace">>)
    .groupBy(...(keys as Measure<"per_trace">[]));
  const kept = keyKept(input, grouping, groupKey);
  const having = kept.length > 0 ? grouped.having(() => allOf(kept) as never) : grouped;
  const ordered = having.orderBy("period");
  return (dated ? ordered.orderBy("date") : ordered)
    .settings({
      ...settings,
      log_comment: "analytics:timeseries:trace_summaries:span_grouped_runs",
    })
    .build() as ReaderReadStatement;
}

type PerEntity = NonNullable<ReturnType<typeof perEntityOf>>;

/** Per trace: the pipeline's entity, the metric's operand and condition, the series filter. */
function carriedPerEntity({
  perEntity: { spec, outer },
  source,
  conditions,
}: {
  perEntity: PerEntity;
  source: MetricSource<string>;
  conditions: Condition<string>[];
}): Record<string, Measure<"trace_summaries">> {
  const carried: Record<string, Measure> = { entity: fn.any(outer.key(source)) };
  const operand = spec.operand?.(source);
  const condition = spec.condition?.(source);
  if (operand) carried.v = fn.any(operand);
  if (condition) carried.c = fn.any(condition);
  if (conditions.length > 0) carried.f = fn.any(allOf(conditions));
  return carried as Record<string, Measure<"trace_summaries">>;
}

/** The per-trace rows as a metric source: a trace count reads their member and trace. */
function carriedSource(perTrace: PerTraceRows): MetricSource<string> {
  const only = () => {
    throw new Error("A per-trace pipeline reads its carried columns only.");
  };
  return {
    trace: (name) => {
      if (name === "TenantId") return perTrace.TenantId!;
      if (name === "TraceId") return perTrace.trace_id!;
      return only();
    },
    attribute: only,
    span: only,
    evaluation: only,
  };
}

/** The pipeline's inner metric over the carried operand and condition. */
function innerOf(spec: MetricSpec, perTrace: PerTraceRows): MetricSpec {
  return {
    ...spec,
    outer: undefined,
    operand: spec.operand ? ((() => perTrace.v!) as MetricOperand) : undefined,
    condition: spec.condition ? ((() => perTrace.c!) as MetricPredicate) : undefined,
  };
}

const outerOf = (aggregation: "sum" | "avg" | "min" | "max", of: Measure): Measure => {
  switch (aggregation) {
    case "sum":
      return fn.sum(of);
    case "avg":
      return fn.avg(of);
    case "min":
      return fn.min(of);
    case "max":
      return fn.max(of);
  }
};

/**
 * One pipeline by a span grouping (ruling 1a; main dropped these): each member's trace once per
 * period, date and key, its metric per member's entity, then over the entities in each key.
 */
export function spanGroupedPipelineTimeseriesRead({
  scope,
  input,
  settings,
}: TimeseriesRead): ReaderReadStatement {
  const grouping = getSpanGrouping(input.groupBy);
  const series = input.series[0]!;
  const perEntity = perEntityOf(series, 0);
  if (!perEntity || input.series.length !== 1) {
    throw new Error("The span-grouped pipeline read takes one pipeline under a span grouping.");
  }
  const perTrace = perTraceRowsOf({
    scope,
    input,
    grouping,
    carry: ({ input: carried, source, ops }) =>
      carriedPerEntity({
        perEntity,
        source,
        conditions: seriesConditions({ series, input: carried, ops }),
      }),
  });
  const inner = innerOf(perEntity.spec, perTrace);
  const { outer } = perEntity;
  const dated = typeof input.timeScale === "number";
  const buckets: Record<string, Measure> = { period: perTrace.period! };
  if (dated) buckets.date = perTrace.date!;
  buckets.group_key = perTrace.group_key!;
  const filtered = perTrace.f as Condition<string> | undefined;
  const scan = clickhouseRead({ scope })
    .from(perTrace)
    .select({
      ...buckets,
      inner_value: renderMetric({ spec: inner, source: carriedSource(perTrace) }),
    } as Record<string, Measure<"per_trace">>);
  const entities = (filtered ? scan.where(() => filtered as never) : scan)
    .groupBy(
      ...([
        ...Object.values(buckets),
        perTrace.TenantId!,
        perTrace.entity!,
      ] as Measure<"per_trace">[]),
    )
    .having(() => cond.ne(perTrace.entity!, param.string("")) as never)
    .as("entities");
  const groupKey = entities.group_key!;
  const keys = [entities.period!, ...(dated ? [entities.date!] : []), groupKey];
  const selection: Record<string, Measure> = { period: entities.period! };
  if (dated) selection.date = entities.date!;
  selection.group_key = groupKey;
  selection[seriesAlias(series, 0)] = outerOf(outer.aggregation, entities.inner_value!);
  const grouped = clickhouseRead({ scope })
    .from(entities)
    .select(selection as Record<string, Measure<"entities">>)
    .groupBy(...(keys as Measure<"entities">[]));
  const kept = keyKept(input, grouping, groupKey);
  const having = kept.length > 0 ? grouped.having(() => allOf(kept) as never) : grouped;
  const ordered = having.orderBy("period");
  return (dated ? ordered.orderBy("date") : ordered)
    .settings({
      ...settings,
      log_comment: "analytics:timeseries:trace_summaries:span_grouped_pipeline",
    })
    .build() as ReaderReadStatement;
}

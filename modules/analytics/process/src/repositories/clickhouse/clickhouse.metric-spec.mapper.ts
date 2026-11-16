/**
 * Metric specs (ADR-202 Decided 19): what a dashboard metric aggregates, over which operand and
 * condition, as data each query shape renders through the typed builder. No SQL text. The text
 * translator beside it serves the shapes not yet on the builder, until they are ported.
 */

import {
  type AggregationTypes,
  type AnalyticsSeries,
  isZeroWhenAbsentSeries,
  type PipelineAggregationTypes,
} from "@langwatch/analytics-contract";
import {
  column,
  type Condition,
  cond,
  type Expression,
  fn,
  param,
} from "@langwatch/clickhouse-client/builder";

import {
  type CHTable,
  type FieldMapping,
  pickFieldMapping,
} from "./clickhouse.field-mappings.mapper.ts";
import {
  type EvaluationMetricKey,
  type EventMetricKey,
  isEvaluationMetricKey,
  isEventMetricKey,
  isMetadataMetricKey,
  isPercentileAggregation,
  isSentimentMetricKey,
  type MetadataMetricKey,
  KNOWN_METRIC_KEYS,
  percentileToPercent,
  unknownMetricError,
} from "./clickhouse.metric-translator.mapper.ts";
import type { Measure } from "./clickhouse.timeseries-query-shared.mapper.ts";

/** The `trace_summaries` columns a metric reads. */
export type TraceMetricColumn =
  | "TenantId"
  | "TraceId"
  | "TraceName"
  | "OccurredAt"
  | "CreatedAt"
  | "UpdatedAt"
  | "TopicId"
  | "SubTopicId"
  | "TotalDurationMs"
  | "TimeToFirstTokenMs"
  | "TotalCost"
  | "NonBilledCost"
  | "TotalPromptTokenCount"
  | "TotalCompletionTokenCount"
  | "TokensPerSecond"
  | "ContainsErrorStatus"
  | "ErrorMessage";

/** The joined `stored_spans` and `evaluation_runs` columns a metric reads. */
export type SpanMetricColumn = "Events.Name" | "Events.Attributes" | "SpanAttributes";
export type EvaluationMetricColumn = "EvaluatorId" | "EvaluationId" | "Score" | "Passed" | "Status";

/** Where a shape reads a metric's columns: one trace's row, and the rows joined to it. */
export type MetricSource<T extends string> = {
  trace: (column: TraceMetricColumn) => Measure<T>;
  attribute: (key: string) => Measure<T>;
  span: (column: SpanMetricColumn) => Measure<T>;
  evaluation: (column: EvaluationMetricColumn) => Measure<T>;
};

export type MetricOperand = <T extends string>(source: MetricSource<T>) => Measure<T>;
export type MetricPredicate = <T extends string>(source: MetricSource<T>) => Condition<T>;

type PercentileMode = "exact" | "tdigest";

export type MetricAggregate =
  | { fn: "sum" | "avg" | "min" | "max" | "uniq" | "count" }
  | { fn: "quantile"; level: number; mode: PercentileMode };

/**
 * A re-aggregation over an inner grouping: per entity (a pipeline: inner aggregate per key, outer
 * over the keys), or the thread duration (per thread, then averaged, optionally per entity).
 */
export type MetricOuter =
  | { kind: "per-entity"; key: MetricOperand; aggregation: PipelineAggregationTypes }
  | {
      kind: "thread-duration";
      thread: MetricOperand;
      perEntity?: { key: MetricOperand; aggregation: PipelineAggregationTypes };
    };

export type MetricSpec = {
  /** Tables the operand or condition reads beyond `trace_summaries`. */
  joins: readonly CHTable[];
  /** `array`: the operand is an array per row, aggregated over every element. */
  form: "scalar" | "array";
  aggregate: MetricAggregate;
  /** Absent: the aggregate counts rows. */
  operand?: MetricOperand;
  condition?: MetricPredicate;
  outer?: MetricOuter;
};

/** The longest a thread may last, in milliseconds (3 hours). */
export const MAX_THREAD_SESSION_DURATION_MS = 3 * 60 * 60 * 1000;

const ZERO = param.uint32(0);

/** Keyed by member: two members of a group project can hold the same id (ADR-177). */
export function memberScoped<T extends string>(
  source: MetricSource<T>,
  id: Measure<T>,
): Measure<T> {
  return fn.if(
    cond.eq(id, param.string("")),
    param.string(""),
    fn.concat(source.trace("TenantId"), "/", id),
  );
}

const memberScopedAttribute =
  (key: string): MetricOperand =>
  (source) =>
    memberScoped(source, source.attribute(key));

/** The bundled (non-billed) cost; rows folded before NonBilledCost read the legacy flag. */
export function nonBilledCost<T extends string>(source: MetricSource<T>): Measure<T> {
  return fn.coalesce(
    source.trace("NonBilledCost"),
    fn.if(
      cond.eq(source.attribute("langwatch.cost.non_billable"), param.string("true")),
      source.trace("TotalCost"),
      ZERO,
    ),
    ZERO,
  );
}

const reservedTokens =
  (key: string): MetricOperand =>
  (source) =>
    fn.toUInt64OrZero(source.attribute(`langwatch.reserved.${key}`));

const traceColumn =
  (column: TraceMetricColumn): MetricOperand =>
  (source) =>
    source.trace(column);

function aggregateOf(aggregation: AggregationTypes, mode: PercentileMode): MetricAggregate {
  if (isPercentileAggregation(aggregation)) {
    return { fn: "quantile", level: percentileToPercent[aggregation], mode };
  }
  switch (aggregation) {
    case "avg":
    case "sum":
    case "min":
    case "max":
      return { fn: aggregation };
    case "cardinality":
    case "terms":
      return { fn: "uniq" };
    default:
      return { fn: "count" };
  }
}

const scalar = (
  aggregation: AggregationTypes,
  operand: MetricOperand,
  mode: PercentileMode = "exact",
): MetricSpec => ({
  joins: [],
  form: "scalar",
  aggregate: aggregateOf(aggregation, mode),
  operand,
});

/** A trace's processed tokens: input, output, cache read and cache write (reasoning is output). */
const totalTokens: MetricOperand = (source) =>
  fn.plus(
    fn.plus(
      fn.plus(
        fn.coalesce(source.trace("TotalPromptTokenCount"), ZERO),
        fn.coalesce(source.trace("TotalCompletionTokenCount"), ZERO),
      ),
      reservedTokens("cache_read_tokens")(source),
    ),
    reservedTokens("cache_creation_tokens")(source),
  );

const PERFORMANCE_OPERANDS: Record<string, MetricOperand> = {
  "performance.completion_time": traceColumn("TotalDurationMs"),
  "performance.first_token": traceColumn("TimeToFirstTokenMs"),
  "performance.total_cost": traceColumn("TotalCost"),
  "performance.cost_billed": (source) =>
    fn.minus(fn.coalesce(source.trace("TotalCost"), ZERO), nonBilledCost(source)),
  "performance.cost_non_billed": nonBilledCost,
  "performance.prompt_tokens": traceColumn("TotalPromptTokenCount"),
  "performance.completion_tokens": traceColumn("TotalCompletionTokenCount"),
  "performance.cache_read_tokens": reservedTokens("cache_read_tokens"),
  "performance.cache_write_tokens": reservedTokens("cache_creation_tokens"),
  "performance.reasoning_tokens": reservedTokens("reasoning_tokens"),
  "performance.total_tokens": totalTokens,
  "performance.total_processed_tokens": totalTokens,
  "performance.tokens_per_second": traceColumn("TokensPerSecond"),
};

/** Span-level token counts, for grouping by span-level attributes such as the model. */
const SPAN_TOKEN_KEYS: Record<string, string> = {
  "spans.metrics.prompt_tokens": "gen_ai.usage.input_tokens",
  "spans.metrics.completion_tokens": "gen_ai.usage.output_tokens",
};

/** A user or thread id: its member-scoped count skips empty ids, as ES's terms aggregation did. */
function idSpec(idKey: string, aggregation: AggregationTypes): MetricSpec {
  if (aggregation !== "cardinality") {
    return scalar(aggregation, (source) => source.attribute(idKey));
  }
  return {
    ...scalar(aggregation, memberScopedAttribute(idKey)),
    condition: (source) => cond.ne(memberScopedAttribute(idKey)(source), param.string("")),
  };
}

function getMetadataSpec(metric: MetadataMetricKey, aggregation: AggregationTypes): MetricSpec {
  switch (metric) {
    case "metadata.user_id":
      return idSpec("langwatch.user_id", aggregation);
    case "metadata.thread_id":
      return idSpec("gen_ai.conversation.id", aggregation);
    case "metadata.trace_id":
      return scalar(aggregation, traceColumn("TraceId"));
    case "metadata.span_type": {
      // Cardinality counts traces; anything else reads the spans, which fan the trace out.
      const spec = scalar(aggregation, traceColumn("TraceId"));
      return aggregation === "cardinality" ? spec : { ...spec, joins: ["stored_spans"] };
    }
  }
}

function getEvaluationSpec({
  metric,
  aggregation,
  evaluatorId,
}: {
  metric: EvaluationMetricKey;
  aggregation: AggregationTypes;
  evaluatorId?: string;
}): MetricSpec {
  const ofEvaluator: MetricPredicate = (source) =>
    evaluatorId === undefined
      ? cond.always()
      : cond.eq(source.evaluation("EvaluatorId"), param.string(evaluatorId));
  const processed: MetricPredicate = (source) =>
    cond.and(ofEvaluator(source), cond.eq(source.evaluation("Status"), param.string("processed")));
  const base = { joins: ["evaluation_runs"] as const, form: "scalar" as const };
  switch (metric) {
    case "evaluations.evaluation_score":
      return {
        ...base,
        aggregate: aggregateOf(aggregation, "exact"),
        operand: (source) => source.evaluation("Score"),
        condition: processed,
      };
    case "evaluations.evaluation_pass_rate":
      return {
        ...base,
        aggregate: aggregateOf(aggregation, "exact"),
        operand: (source) => fn.toFloat64(source.evaluation("Passed")),
        condition: processed,
      };
    case "evaluations.evaluation_runs":
      return {
        ...base,
        aggregate: { fn: "uniq" },
        operand: (source) => source.evaluation("EvaluationId"),
        condition: ofEvaluator,
      };
  }
}

/** Per event, the named attribute as a number when the event is of `eventType` (any, if unset). */
function eventValues({
  eventType,
  attributeKey,
  keepZero,
}: {
  eventType?: string;
  attributeKey: string;
  keepZero: boolean;
}): MetricOperand {
  return <T extends string>(source: MetricSource<T>): Measure<T> => {
    // Lambda parameters type only over concrete tables, so the arrays are read as `string`'s.
    const names = source.span("Events.Name") as Expression<readonly string[], string>;
    const attributes = source.span("Events.Attributes") as Expression<
      readonly Readonly<Record<string, string>>[],
      string
    >;
    const value = (a: Expression<Readonly<Record<string, string>>, never>) =>
      fn.toFloat64OrNull(fn.mapGet(a, attributeKey));
    const values: Expression<readonly (number | null)[], string> =
      eventType === undefined
        ? fn.arrayMap((a) => value(a), attributes)
        : fn.arrayMap(
            (n, a) =>
              fn.if(cond.eq(n, eventType), value(a), fn.nullAs(column.nullable(column.float64()))),
            names,
            attributes,
          );
    return fn.arrayFilter(
      (x) => (keepZero ? cond.isNotNull(x) : cond.and(cond.isNotNull(x), cond.ne(x, 0))),
      values,
    ) as Measure<T>;
  };
}

function getEventSpec({
  metric,
  aggregation,
  eventType,
  metricKey,
}: {
  metric: EventMetricKey;
  aggregation: AggregationTypes;
  eventType?: string;
  metricKey?: string;
}): MetricSpec {
  switch (metric) {
    case "events.event_type":
      return {
        joins: SPANS,
        form: "scalar",
        aggregate: { fn: "count" },
        condition: (source) =>
          eventType === undefined
            ? cond.gt(fn.length(source.span("Events.Name")), 0)
            : fn.has(source.span("Events.Name"), eventType),
      };
    case "events.event_score":
      return {
        joins: SPANS,
        form: "array",
        aggregate: aggregateOf(aggregation, "exact"),
        operand: eventValues({
          eventType,
          attributeKey: metricKey ?? "event.metrics.score",
          keepZero: true,
        }),
      };
    case "events.event_details":
      throw new Error(
        `Metric events.event_details is not yet supported in ClickHouse ` +
          `(aggregation=${aggregation}, metricKey=${metricKey ?? "undefined"})`,
      );
  }
}

/** Thumbs up and down: traces voting, or the votes, zero votes dropped as ES's must_not did. */
function getSentimentSpec(aggregation: AggregationTypes): MetricSpec {
  if (aggregation === "cardinality") {
    return {
      joins: SPANS,
      form: "scalar",
      aggregate: { fn: "count" },
      condition: (source) => fn.has(source.span("Events.Name"), "thumbs_up_down"),
    };
  }
  return {
    joins: SPANS,
    form: "array",
    aggregate: aggregateOf(aggregation, "exact"),
    operand: eventValues({
      eventType: "thumbs_up_down",
      attributeKey: "event.metrics.vote",
      keepZero: false,
    }),
  };
}

const SPANS: readonly CHTable[] = ["stored_spans"];

/** A field-mapped column: a plain column, or one key of a map column. */
function getMappedSpec(mapping: FieldMapping, aggregation: AggregationTypes): MetricSpec {
  const keyed = /^(\w+)\['([^']+)'\]$/.exec(mapping.column);
  const operand: MetricOperand = (source) => {
    switch (mapping.table) {
      case "trace_summaries":
        if (keyed?.[1] === "Attributes" && keyed[2]) return source.attribute(keyed[2]);
        return source.trace(mapping.column as TraceMetricColumn);
      case "stored_spans":
        return keyed?.[2]
          ? fn.mapGet(source.span(keyed[1] as SpanMetricColumn), keyed[2])
          : source.span(mapping.column as SpanMetricColumn);
      case "evaluation_runs":
        return source.evaluation(mapping.column as EvaluationMetricColumn);
    }
  };
  const spec = scalar(aggregation, operand);
  return mapping.table === "trace_summaries" ? spec : { ...spec, joins: [mapping.table] };
}

/** The thread a trace belongs to, keyed by member. */
const threadOf = memberScopedAttribute("gen_ai.conversation.id");

/** One series' metric as a spec; a metric with no spec is refused, never compiled. */
export function metricSpecFor({
  metric,
  aggregation,
  index,
  key,
  subkey,
}: {
  metric: string;
  aggregation: AggregationTypes;
  index: number;
  key?: string;
  subkey?: string;
}): MetricSpec {
  if (!KNOWN_METRIC_KEYS.has(metric)) throw unknownMetricError(index);

  const performance = PERFORMANCE_OPERANDS[metric];
  if (performance) return scalar(aggregation, performance, "tdigest");
  const spanTokens = SPAN_TOKEN_KEYS[metric];
  if (spanTokens) {
    return {
      ...scalar(
        aggregation,
        (source) => fn.toFloat64OrNull(fn.mapGet(source.span("SpanAttributes"), spanTokens)),
        "tdigest",
      ),
      joins: ["stored_spans"],
    };
  }
  if (metric === "threads.average_duration_per_thread") {
    return {
      joins: [],
      form: "scalar",
      aggregate: { fn: "avg" },
      outer: { kind: "thread-duration", thread: threadOf },
    };
  }
  if (isMetadataMetricKey(metric)) return getMetadataSpec(metric, aggregation);
  if (isEvaluationMetricKey(metric)) {
    return getEvaluationSpec({ metric, aggregation, evaluatorId: key });
  }
  if (isEventMetricKey(metric)) {
    return getEventSpec({ metric, aggregation, eventType: key, metricKey: subkey });
  }
  if (isSentimentMetricKey(metric)) return getSentimentSpec(aggregation);
  const mapping = pickFieldMapping(metric);
  if (!mapping) throw unknownMetricError(index);
  return getMappedSpec(mapping, aggregation);
}

/** The entity a pipeline aggregates per; an unknown field falls back to the trace. */
function pipelineKeyOf(field: string): MetricOperand {
  switch (field) {
    case "user_id":
      return memberScopedAttribute("langwatch.user_id");
    case "thread_id":
      return threadOf;
    case "customer_id":
      return memberScopedAttribute("langwatch.customer_id");
    default:
      return traceColumn("TraceId");
  }
}

/** A pipeline series: the metric per entity, re-aggregated over the entities. */
export function pipelineMetricSpecFor({
  pipelineField,
  pipelineAggregation,
  ...series
}: {
  metric: string;
  aggregation: AggregationTypes;
  pipelineField: string;
  pipelineAggregation: PipelineAggregationTypes;
  index: number;
  key?: string;
  subkey?: string;
}): MetricSpec {
  const inner = metricSpecFor(series);
  const key = pipelineKeyOf(pipelineField);
  if (inner.outer?.kind === "thread-duration") {
    return {
      ...inner,
      outer: { ...inner.outer, perEntity: { key, aggregation: pipelineAggregation } },
    };
  }
  return { ...inner, outer: { kind: "per-entity", key, aggregation: pipelineAggregation } };
}

function quantileAggregate<T extends string>(
  { level, mode }: { level: number; mode: PercentileMode },
  of: Measure<T>,
  when: Condition<T> | undefined,
): Measure<T> {
  if (when) {
    return mode === "tdigest"
      ? fn.quantileTDigestIf(level, of, when)
      : fn.quantileExactIf(level, of, when);
  }
  return mode === "tdigest" ? fn.quantileTDigest(level, of) : fn.quantileExact(level, of);
}

function plainAggregate<T extends string>(
  name: "sum" | "avg" | "min" | "max" | "uniq",
  of: Measure<T>,
  when: Condition<T> | undefined,
): Measure<T> {
  switch (name) {
    case "sum":
      return when ? fn.sumIf(of, when) : fn.sum(of);
    case "avg":
      return when ? fn.avgIf(of, when) : fn.avg(of);
    case "min":
      return when ? fn.minIf(of, when) : fn.min(of);
    case "max":
      return when ? fn.maxIf(of, when) : fn.max(of);
    case "uniq":
      return when ? fn.uniqIf(of, when) : fn.uniq(of);
  }
}

function countAggregate<T extends string>(
  of: Measure<T> | undefined,
  when: Condition<T> | undefined,
): Measure<T> {
  if (of === undefined) return when ? fn.countIf(when) : fn.count();
  return when ? fn.countIf(cond.and(cond.isNotNull(of), when)) : fn.count(of);
}

function scalarAggregate<T extends string>({
  aggregate,
  of,
  when,
  zeroWhenEmpty,
}: {
  aggregate: MetricAggregate;
  of: Measure<T> | undefined;
  when: Condition<T> | undefined;
  zeroWhenEmpty: boolean;
}): Measure<T> {
  if (aggregate.fn === "count" || of === undefined) return countAggregate(of, when);
  if (aggregate.fn === "quantile") return quantileAggregate(aggregate, of, when);
  const value = plainAggregate(aggregate.fn, of, when);
  return aggregate.fn === "sum" && zeroWhenEmpty ? fn.coalesce(value, ZERO) : value;
}

function arrayQuantile<T extends string>(
  { level, mode }: { level: number; mode: PercentileMode },
  of: Measure<T>,
  when: Condition<T> | undefined,
): Measure<T> {
  if (mode === "tdigest") {
    return when ? fn.quantileTDigestArrayIf(level, of, when) : fn.quantileTDigestArray(level, of);
  }
  return when ? fn.quantileExactArrayIf(level, of, when) : fn.quantileExactArray(level, of);
}

/** Main's array forms; a condition takes the `-ArrayIf` combinator, array first (cond scalar). */
function arrayAggregate<T extends string>(
  aggregate: MetricAggregate,
  of: Measure<T>,
  when: Condition<T> | undefined,
): Measure<T> {
  switch (aggregate.fn) {
    case "quantile":
      return arrayQuantile(aggregate, of, when);
    case "sum":
      return fn.coalesce(when ? fn.sumArrayIf(of, when) : fn.sumArray(of), ZERO);
    case "avg":
      return when ? fn.avgArrayIf(of, when) : fn.avgArray(of);
    case "min":
      return when ? fn.minArrayIf(of, when) : fn.minArray(of);
    case "max":
      return when ? fn.maxArrayIf(of, when) : fn.maxArray(of);
    case "uniq":
      return when ? fn.uniqArrayIf(of, when) : fn.uniqArray(of);
    case "count":
      return when ? fn.sumIf(fn.length(of), when) : fn.sum(fn.length(of));
  }
}

/**
 * A spec's aggregate over `source`, with the series' own condition ANDed into the metric's.
 * A sum with no condition of the metric's own reads 0, never NULL, over no rows (main's coalesce).
 */
export function renderMetric<T extends string>({
  spec,
  source,
  when,
}: {
  spec: MetricSpec;
  source: MetricSource<T>;
  when?: Condition<T>;
}): Measure<T> {
  if (spec.outer) {
    throw new Error("A re-aggregated metric is rendered by its query shape, not on one scan.");
  }
  const own = spec.condition?.(source);
  const condition = own && when ? cond.and(own, when) : (own ?? when);
  const of = spec.operand?.(source);
  if (spec.form === "array") {
    if (!of) throw new Error("An array metric needs an operand.");
    return arrayAggregate(spec.aggregate, of, condition);
  }
  return scalarAggregate({ aggregate: spec.aggregate, of, when: condition, zeroWhenEmpty: !own });
}

/**
 * A series' own filter and percentage mode over `render` (main's shapeSeriesExpression): percentage
 * is ES's `bucket_script`, and a non-additive series reads NULL, not 0, when nothing matched.
 */
export function shapeSeries<T extends string>({
  series,
  when,
  render,
}: {
  series: AnalyticsSeries;
  when: Condition<T> | undefined;
  render: (when?: Condition<T>) => Measure<T>;
}): Measure<T> {
  const filtered = render(when);
  if (!when) return filtered;
  const all = series.asPercent ? render() : undefined;
  const shaped = all
    ? (fn.if(
        cond.gt(all, 0),
        fn.multiply(fn.divide(filtered, all), 100),
        param.uint32(0),
      ) as Measure<T>)
    : filtered;
  if (isZeroWhenAbsentSeries(series)) return shaped;
  return fn.if(
    cond.gt(fn.countIf(when), 0),
    shaped,
    fn.nullAs(column.nullable(column.float64())),
  ) as Measure<T>;
}

/** The thread-duration inner value: first to last trace of a thread, in ms, capped. */
export function threadDuration<T extends string>(occurredAt: Measure<T>): Measure<T> {
  return fn.least(
    fn.multiply(fn.minus(fn.max(occurredAt), fn.min(occurredAt)), 1000),
    param.uint32(MAX_THREAD_SESSION_DURATION_MS),
  );
}

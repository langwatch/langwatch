/**
 * A trace's additive metrics split across the models its spans used (main's span-model partition,
 * aggregation-builder:586-673) on the typed builder (ADR-202): one row per member's trace and span
 * model, each bucket its spans' share. A trace whose spans were not all read keeps its whole value.
 */

import {
  clickhouseRead,
  type Condition,
  cond,
  type Expression,
  fn,
  param,
  type ProofScope,
} from "@langwatch/clickhouse-client/builder";
import { MAX_PROCESSED_SPANS } from "@langwatch/trace-contract";

import type { TimeseriesQueryInput } from "./clickhouse.aggregation-builder.mapper.ts";
import { inSpanEnvelope } from "./clickhouse.joined-timeseries-query.mapper.ts";
import {
  type MetricSource,
  nonBilledCost,
  type TraceMetricColumn,
} from "./clickhouse.metric-spec.mapper.ts";
import { storedSpans as ss } from "./clickhouse.stored-spans.table.ts";
import type { Measure } from "./clickhouse.timeseries-query-shared.mapper.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";

const ZERO = param.uint32(0);
const UNKNOWN = param.string("unknown");

/**
 * Settings main sent with a model-grouped read: a grace hash join spills the per-trace-and-model
 * side to disk past `max_bytes_in_join`, and fewer threads bound the spilled merge.
 */
export const SPAN_MODEL_PARTITION_SETTINGS = {
  join_algorithm: "grace_hash",
  max_bytes_in_join: 200_000_000,
  max_threads: 4,
} as const;

const attribute = (key: string) => fn.mapGet(ss.SpanAttributes, key);
const asNumber = (key: string) => fn.toFloat64OrNull(attribute(key));

/** A duplicate usage copy adds nothing to the trace's totals, so nothing to a bucket either. */
const notSkipped = cond.ne(
  attribute("langwatch.reserved.skip_token_accumulation"),
  param.string("true"),
);
const contribution = (of: Measure<"stored_spans">) => fn.max(fn.if(notSkipped, of, ZERO));
const tokens = (key: string) => fn.greatest(fn.coalesce(asNumber(key), ZERO), ZERO);
const firstPositive = (keys: string[]) =>
  fn.multiIf(
    keys.map((key) => [cond.gt(fn.coalesce(asNumber(key), ZERO), ZERO), asNumber(key)] as const),
    ZERO as Measure<"stored_spans">,
  );

/** A span's model: response model, else request model, else 'unknown' (as the cost fold reads). */
export const modelOfSpan: Expression<string, "stored_spans"> = fn.multiIf(
  [
    [
      cond.ne(attribute("gen_ai.response.model"), param.string("")),
      attribute("gen_ai.response.model"),
    ],
    [
      cond.ne(attribute("gen_ai.request.model"), param.string("")),
      attribute("gen_ai.request.model"),
    ],
  ],
  UNKNOWN,
);

const BUCKET_COLUMNS = [
  "SpanModelCost",
  "SpanModelNonBilledCost",
  "SpanModelPromptTokens",
  "SpanModelCompletionTokens",
  "SpanModelCacheReadTokens",
  "SpanModelCacheWriteTokens",
  "SpanModelReasoningTokens",
] as const;
type BucketColumn = (typeof BUCKET_COLUMNS)[number];

const perColumn = <V>(of: (name: BucketColumn, index: number) => V) =>
  Object.fromEntries(BUCKET_COLUMNS.map((name, index) => [name, of(name, index)])) as Record<
    BucketColumn,
    V
  >;

const PER_SPAN: Record<BucketColumn, Measure<"stored_spans">> = {
  SpanModelCost: contribution(fn.coalesce(ss.Cost, ZERO)),
  SpanModelNonBilledCost: contribution(fn.coalesce(ss.NonBilledCost, ZERO)),
  SpanModelPromptTokens: contribution(tokens("gen_ai.usage.input_tokens")),
  SpanModelCompletionTokens: contribution(tokens("gen_ai.usage.output_tokens")),
  SpanModelCacheReadTokens: contribution(
    firstPositive(["gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.cached_tokens"]),
  ),
  SpanModelCacheWriteTokens: contribution(
    firstPositive(["gen_ai.usage.cache_creation.input_tokens"]),
  ),
  SpanModelReasoningTokens: contribution(firstPositive(["gen_ai.usage.reasoning_tokens"])),
};

type Bucket = readonly [string, number, number, number, number, number, number, number];

/** One row per member's trace and span model, with the trace's read span count beside it. */
function modelBucketsRead(scope: ProofScope, input: TimeseriesQueryInput) {
  const spans = clickhouseRead({ scope })
    .from(ss)
    .withinWindows()
    .select({
      TenantId: ss.TenantId,
      TraceId: ss.TraceId,
      SpanId: ss.SpanId,
      SpanModelKey: modelOfSpan,
      ...PER_SPAN,
    })
    .where(() => inSpanEnvelope(input))
    .groupBy(ss.TenantId, ss.TraceId, ss.SpanId, modelOfSpan)
    .as("span_models");

  const models = clickhouseRead({ scope })
    .from(spans)
    .select({
      TenantId: spans.TenantId!,
      TraceId: spans.TraceId!,
      SpanModelKey: spans.SpanModelKey!,
      BucketSpanCount: fn.count(),
      ...perColumn((name) => fn.sum(spans[name])),
    })
    .groupBy(spans.TenantId!, spans.TraceId!, spans.SpanModelKey!)
    .as("trace_models");

  // Main's per-trace total is a second grouping, not a window: both aggregations spill to disk.
  const traces = clickhouseRead({ scope })
    .from(models)
    .select({
      TenantId: models.TenantId!,
      TraceId: models.TraceId!,
      TraceSpanCount: fn.sum(models.BucketSpanCount!),
      buckets: fn.groupArray(
        fn.tuple(models.SpanModelKey!, ...BUCKET_COLUMNS.map((name) => models[name]!)),
      ),
    })
    .groupBy(models.TenantId!, models.TraceId!)
    .as("trace_buckets");

  const rows = clickhouseRead({ scope })
    .from(traces)
    .select({
      TenantId: traces.TenantId!,
      TraceId: traces.TraceId!,
      TraceSpanCount: traces.TraceSpanCount!,
      bucket: fn.arrayJoin(traces.buckets!),
    })
    .as("bucket_rows");

  const bucket = rows.bucket as Expression<Bucket, "bucket_rows">;
  const element = (index: number) =>
    fn.tupleElement(bucket, String(index) as "0") as Measure<"bucket_rows">;
  const columns = perColumn((_, index) => element(index + 1));
  return clickhouseRead({ scope })
    .from(rows)
    .select({
      TenantId: rows.TenantId!,
      TraceId: rows.TraceId!,
      TraceSpanCount: rows.TraceSpanCount!,
      SpanModelKey: element(0),
      ...columns,
    })
    .where(() =>
      cond.or(
        cond.ne(element(0), UNKNOWN),
        ...BUCKET_COLUMNS.map((name) => cond.gt(columns[name], ZERO)),
      ),
    )
    .as("smd");
}

/** The span-model buckets, LEFT JOINed on (TenantId, TraceId) by the model-grouped read. */
export type ModelBuckets = ReturnType<typeof modelBucketsRead>;

export function modelBucketsOf(scope: ProofScope, input: TimeseriesQueryInput): ModelBuckets {
  return modelBucketsRead(scope, input);
}

type Partitioned = "trace_summaries" | "smd";

/**
 * True when the trace keeps its whole value under its primary model: no bucket joined, more spans
 * than the fold reads, or fewer spans read than the trace holds.
 */
function missOf(smd: ModelBuckets): Condition<Partitioned> {
  const key = smd.SpanModelKey!;
  return cond.or(
    cond.isNull(key),
    cond.eq(key, param.string("")),
    cond.gt(ts.SpanCount, param.uint32(MAX_PROCESSED_SPANS)),
    cond.lt(smd.TraceSpanCount!, ts.SpanCount),
  ) as Condition<Partitioned>;
}

/** The model a row of the partition counts under. */
export function modelKeyOf(smd: ModelBuckets): Measure<Partitioned> {
  return fn.if(
    missOf(smd),
    fn.if(fn.empty(ts.Models), UNKNOWN, fn.arrayElement(ts.Models, 1)),
    smd.SpanModelKey!,
  ) as Measure<Partitioned>;
}

const SPLIT_COLUMNS: Partial<Record<TraceMetricColumn, BucketColumn>> = {
  TotalCost: "SpanModelCost",
  TotalPromptTokenCount: "SpanModelPromptTokens",
  TotalCompletionTokenCount: "SpanModelCompletionTokens",
};

const RESERVED_COLUMNS: Record<string, BucketColumn> = {
  cache_read_tokens: "SpanModelCacheReadTokens",
  cache_creation_tokens: "SpanModelCacheWriteTokens",
  reasoning_tokens: "SpanModelReasoningTokens",
};

const traceOnly = (): never => {
  throw new Error("The model-grouped read carries trace-row metrics only.");
};

const wholeTrace: MetricSource<Partitioned> = {
  trace: (name) => ts[name],
  attribute: (key) => fn.mapGet(ts.Attributes, key),
  span: traceOnly,
  evaluation: traceOnly,
};

/**
 * Metric columns over the partition: cost, non-billed cost and token counts are the bucket's share,
 * every other column (duration, time to first token, tokens per second) the whole trace's.
 */
export function partitionedSource(smd: ModelBuckets): MetricSource<Partitioned> {
  const miss = missOf(smd);
  const split = (whole: Measure<Partitioned>, share: Measure<Partitioned>) =>
    fn.if(miss, whole, share) as Measure<Partitioned>;
  const share = (name: BucketColumn) => smd[name]! as Measure<Partitioned>;
  const legacyNonBillable = cond.and(
    cond.isNull(ts.NonBilledCost),
    cond.eq(fn.mapGet(ts.Attributes, "langwatch.cost.non_billable"), param.string("true")),
  );
  return {
    ...wholeTrace,
    trace: (name) => {
      const column = SPLIT_COLUMNS[name];
      return column ? split(ts[name], share(column)) : ts[name];
    },
    split: {
      nonBilledCost: () =>
        split(
          nonBilledCost(wholeTrace),
          fn.if(
            legacyNonBillable,
            share("SpanModelCost"),
            share("SpanModelNonBilledCost"),
          ) as Measure<Partitioned>,
        ),
      reservedTokens: (key) => {
        const column = RESERVED_COLUMNS[key];
        if (!column) throw new Error(`No span-model bucket for langwatch.reserved.${key}.`);
        return split(
          fn.toFloat64(fn.toUInt64OrZero(fn.mapGet(ts.Attributes, `langwatch.reserved.${key}`))),
          share(column),
        );
      },
    },
  };
}

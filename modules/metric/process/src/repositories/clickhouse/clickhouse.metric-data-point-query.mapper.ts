/**
 * The rollup reads of metric_data_points as built statements, each on one tenant (ADR-202).
 * Every caller value is bound; a shared scalar binds once however many windows a read carries.
 */
import {
  boundRows,
  type ClickHouseReadStart,
  clickhouseRead,
  column,
  type ConditionOps,
  fn,
  param,
  type SingleTenantScope,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { METRIC_ROLLUP_INTERVAL_MS, type MetricSequencePoint } from "@langwatch/metric-contract";

import type {
  BucketReadRange,
  BucketSeek,
  SeriesWindow,
} from "../../rules/metric-rollup-bucket-reads.rules.ts";
import { metricDataPoints as points } from "./clickhouse.metric-data-points.table.ts";

type SpanEnd = Pick<MetricSequencePoint, "pointId" | "timeUnixMs" | "timeUnixNano">;

/** A series' chunk points reduced to the two that bound them. */
export interface SeekSpan {
  seriesId: string;
  first: SpanEnd;
  last: SpanEnd;
}

const scopeOf = (tenantId: string): SingleTenantScope => tenantScope.single({ tenantId });

/**
 * The columns a seek needs: order (TimeUnixNano, PointId), bucket (TimeMs), predecessor
 * dependency (MetricKind, AggregationTemporality). Nothing that FINAL used to materialise.
 */
const seekSelection = {
  SeriesId: points.SeriesId,
  PointId: points.PointId,
  TimeMs: fn.toUnixTimestamp64Milli(points.TimeUnixMs),
  TimeUnixNano: points.TimeUnixNano,
  MetricKind: points.MetricKind,
  AggregationTemporality: points.AggregationTemporality,
};

/** What a rollup is made of, and the version FINAL would have kept the newest of. */
const payloadSelection = {
  TenantId: points.TenantId,
  PointId: points.PointId,
  SeriesId: points.SeriesId,
  MetricName: points.MetricName,
  MetricUnit: points.MetricUnit,
  MetricKind: points.MetricKind,
  AggregationTemporality: points.AggregationTemporality,
  IsMonotonic: points.IsMonotonic,
  StartTimeUnixNano: points.StartTimeUnixNano,
  TimeUnixNano: points.TimeUnixNano,
  TimeMs: fn.toUnixTimestamp64Milli(points.TimeUnixMs),
  ValueType: points.ValueType,
  ValueInt: points.ValueInt,
  ValueDouble: points.ValueDouble,
  Count: points.Count,
  Sum: points.Sum,
  Min: points.Min,
  Max: points.Max,
  ExplicitBounds: points.ExplicitBounds,
  BucketCounts: points.BucketCounts,
  ExponentialScale: points.ExponentialScale,
  ExponentialZeroThreshold: points.ExponentialZeroThreshold,
  ZeroCount: points.ZeroCount,
  PositiveOffset: points.PositiveOffset,
  PositiveBucketCounts: points.PositiveBucketCounts,
  NegativeOffset: points.NegativeOffset,
  NegativeBucketCounts: points.NegativeBucketCounts,
  DedupVersion: points.DedupVersion,
};

/** The near pass: one OR'd key range per range, so the primary key prunes to exactly those. */
export function bucketRangeStatement({
  tenantId,
  lookbackMs,
  ranges,
}: {
  tenantId: string;
  lookbackMs: number;
  ranges: readonly BucketReadRange[];
}) {
  const lookback = param.int64(lookbackMs);
  const bucket = param.int64(METRIC_ROLLUP_INTERVAL_MS);
  return clickhouseRead({ scope: scopeOf(tenantId) })
    .from(points)
    .select(seekSelection)
    .where(({ and, eq, gte, lt, or }) =>
      or(
        ...ranges.map(({ seriesId, from, to }) =>
          and(
            eq(points.SeriesId, seriesId),
            gte(points.TimeUnixMs, fn.fromUnixTimestamp64Milli(fn.minus(param.int64(from), lookback))),
            lt(points.TimeUnixMs, fn.fromUnixTimestamp64Milli(fn.plus(param.int64(to), bucket))),
          ),
        ),
      ),
    )
    .build();
}

/** One reverse key seek behind one bucket start, inside the half-open predecessor window. */
function predecessorSeek({
  start,
  seek,
  fromAgo,
  toAgo,
}: {
  start: ClickHouseReadStart<SingleTenantScope>;
  seek: BucketSeek;
  fromAgo: ReturnType<typeof param.int64>;
  toAgo: ReturnType<typeof param.int64>;
}) {
  const bucketStart = param.int64(seek.start);
  return start
    .from(points)
    .select(seekSelection)
    .where(({ and, eq, gte, lt }) =>
      and(
        eq(points.SeriesId, seek.seriesId),
        lt(points.TimeUnixMs, fn.fromUnixTimestamp64Milli(fn.minus(bucketStart, toAgo))),
        gte(points.TimeUnixMs, fn.fromUnixTimestamp64Milli(fn.minus(bucketStart, fromAgo))),
      ),
    )
    .orderBy(points.TimeUnixMs, "DESC")
    .orderBy(points.TimeUnixNano, "DESC")
    .orderBy(points.PointId, "DESC")
    .limit(1);
}

/**
 * The far pass: a reverse key seek per bucket, as union arms. The first arm reads through a
 * derived table, since the read's own order and limit would apply to the whole union.
 */
export function farPredecessorStatement({
  tenantId,
  seeks,
  predecessor,
}: {
  tenantId: string;
  seeks: readonly [BucketSeek, ...BucketSeek[]];
  predecessor: { fromMs: number; toMs: number };
}) {
  const scope = scopeOf(tenantId);
  const fromAgo = param.int64(predecessor.fromMs);
  const toAgo = param.int64(predecessor.toMs);
  const [first, ...rest] = seeks;
  const nearest = predecessorSeek({
    start: clickhouseRead({ scope }),
    seek: first,
    fromAgo,
    toAgo,
  }).as("nearest");
  let read = clickhouseRead({ scope }).from(nearest).select({
    SeriesId: nearest.SeriesId,
    PointId: nearest.PointId,
    TimeMs: nearest.TimeMs,
    TimeUnixNano: nearest.TimeUnixNano,
    MetricKind: nearest.MetricKind,
    AggregationTemporality: nearest.AggregationTemporality,
  });
  for (const seek of rest) {
    read = read.unionAll((arm) => predecessorSeek({ start: arm, seek, fromAgo, toAgo }));
  }
  return read.build();
}

/** Exact `[from, to)` windows of the picked points; the key predicate prunes without FINAL. */
export function payloadStatement({
  tenantId,
  windows,
}: {
  tenantId: string;
  windows: readonly SeriesWindow[];
}) {
  return clickhouseRead({ scope: scopeOf(tenantId) })
    .from(points)
    .select(payloadSelection)
    .where(({ and, eq, gte, lt, or }) =>
      or(
        ...windows.map(({ seriesId, from, to }) =>
          and(
            eq(points.SeriesId, seriesId),
            gte(points.TimeUnixMs, from),
            lt(points.TimeUnixMs, to),
          ),
        ),
      ),
    )
    .build();
}

/**
 * The successor seek: spans travel as seven bound arrays the server zips back into one row per
 * series, so the statement and its parameter count stay fixed whatever the chunk holds. Points
 * inside a span cover every successor but the newest; the second arm finds that one.
 */
export function successorSeekStatement({
  tenantId,
  spans,
}: {
  tenantId: string;
  spans: readonly SeekSpan[];
}) {
  const scope = scopeOf(tenantId);
  const seriesIds = param.strings(spans.map((span) => span.seriesId));
  const rows = boundRows({
    name: "span",
    arrays: {
      SeriesId: seriesIds,
      FromTime: param.int64s(spans.map((span) => span.first.timeUnixMs)),
      FromNano: param.strings(spans.map((span) => span.first.timeUnixNano)),
      FromPoint: param.strings(spans.map((span) => span.first.pointId)),
      ToTime: param.int64s(spans.map((span) => span.last.timeUnixMs)),
      ToNano: param.strings(spans.map((span) => span.last.timeUnixNano)),
      ToPoint: param.strings(spans.map((span) => span.last.pointId)),
    },
  });
  const ends = clickhouseRead({ scope })
    .from(rows)
    .select({
      SpanSeriesId: rows.SeriesId,
      SpanFromTime: fn.fromUnixTimestamp64Milli(rows.FromTime),
      SpanFromNano: fn.cast(rows.FromNano, column.uint64()),
      SpanFromPoint: rows.FromPoint,
      SpanToTime: fn.fromUnixTimestamp64Milli(rows.ToTime),
      SpanToNano: fn.cast(rows.ToNano, column.uint64()),
      SpanToPoint: rows.ToPoint,
    })
    .as("spans");
  const scanFrom = Math.min(...spans.map((span) => span.first.timeUnixMs));
  const seriesPoints = clickhouseRead({ scope })
    .from(points)
    .select({
      TenantId: points.TenantId,
      SeriesId: points.SeriesId,
      PointId: points.PointId,
      TimeUnixNano: points.TimeUnixNano,
      MetricKind: points.MetricKind,
      AggregationTemporality: points.AggregationTemporality,
      SeekTime: points.TimeUnixMs,
    })
    .where(({ and, gte, oneOf }) =>
      and(oneOf(points.SeriesId, seriesIds), gte(points.TimeUnixMs, scanFrom)),
    )
    .as("series_points");

  type SeekOps = ConditionOps<"series_points" | "spans", Record<never, never>>;
  /** (SeekTime, TimeUnixNano, PointId) strictly past one end of the joined span. */
  const past = ({ ops, beyond, end }: { ops: SeekOps; beyond: "gt" | "lt"; end: "From" | "To" }) => {
    const { and, eq, or } = ops;
    const [time, nano, point] =
      end === "From"
        ? [ends.SpanFromTime, ends.SpanFromNano, ends.SpanFromPoint]
        : [ends.SpanToTime, ends.SpanToNano, ends.SpanToPoint];
    return or(
      ops[beyond](seriesPoints.SeekTime, time),
      and(
        eq(seriesPoints.SeekTime, time),
        or(
          ops[beyond](seriesPoints.TimeUnixNano, nano),
          and(eq(seriesPoints.TimeUnixNano, nano), ops[beyond](seriesPoints.PointId, point)),
        ),
      ),
    );
  };
  const on = ({ eq }: SeekOps) =>
    eq(fn.cast(seriesPoints.SeriesId, column.string()), ends.SpanSeriesId);
  const selection = {
    SeriesId: seriesPoints.SeriesId,
    PointId: seriesPoints.PointId,
    TimeMs: fn.toUnixTimestamp64Milli(seriesPoints.SeekTime),
    TimeUnixNano: seriesPoints.TimeUnixNano,
    MetricKind: seriesPoints.MetricKind,
    AggregationTemporality: seriesPoints.AggregationTemporality,
  };
  const latestSpanEnd = Math.max(...spans.map((span) => span.last.timeUnixMs));
  const earliestSpanEnd = Math.min(...spans.map((span) => span.last.timeUnixMs));

  return clickhouseRead({ scope })
    .from(seriesPoints)
    .innerJoin(ends, on)
    .select(selection)
    .where((ops) =>
      ops.and(
        ops.lte(seriesPoints.SeekTime, latestSpanEnd),
        past({ ops, beyond: "gt", end: "From" }),
        past({ ops, beyond: "lt", end: "To" }),
      ),
    )
    .unionAll((arm) =>
      arm
        .from(seriesPoints)
        .innerJoin(ends, on)
        .select(selection)
        .where((ops) =>
          ops.and(
            ops.gte(seriesPoints.SeekTime, earliestSpanEnd),
            past({ ops, beyond: "gt", end: "To" }),
          ),
        )
        .orderBy(seriesPoints.SeriesId)
        .orderBy(seriesPoints.SeekTime)
        .orderBy(seriesPoints.TimeUnixNano)
        .orderBy(seriesPoints.PointId)
        .limitBy(1, seriesPoints.SeriesId),
    )
    .build();
}

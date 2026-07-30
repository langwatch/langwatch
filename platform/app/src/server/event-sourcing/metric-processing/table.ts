import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
} from "@langwatch/clickhouse";
import { z } from "zod";

/**
 * The three tables this pipeline's projections write (migration `00049`,
 * deployed). Every one of them partitions and expires on a customer-supplied
 * timestamp today — `TimeUnixMs`, `LastSeenAt`, `BucketStart` — which
 * `defineTable` refuses. Each is declared on a platform `AcceptedAt` instead:
 * the shape the pending re-key migration must produce.
 */

const lowCardinalityString = () => ch.lowCardinality(ch.string());

/** ClickHouse emits Int32 as a bare JSON number, so it needs its own builder. */
function int32(): ColumnDef<number> {
  const schema = z
    .number()
    .int()
    .min(-(2 ** 31))
    .max(2 ** 31 - 1);
  return {
    chType: "Int32",
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  };
}

/** The deployed engine version column: epoch millis in a `UInt64`. */
const dedupVersion = (): ColumnDef<bigint> => ({
  ...ch.uint64(),
  timeRole: "writtenAt",
  platformControlled: true,
});

/**
 * The engine elects the newest observation of a series, so the measurement time
 * is the version — a late old point cannot overwrite a newer row.
 */
const lastSeenAtVersion = (): ColumnDef<Date> => ({
  ...ch.lastAcceptedAt(),
  timeRole: "writtenAt",
});

export const metricDataPointsTable = defineTable({
  name: "metric_data_points",
  merge: replacing({ version: "DedupVersion" }),
  sortKey: ["TenantId", "SeriesId", "TimeUnixMs", "TimeUnixNano", "PointId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    PointId: ch.string(),
    SeriesId: ch.string(),
    ResourceSchemaUrl: ch.string(),
    ResourceAttributesJson: ch.string(),
    ResourceAttributeKeys: ch.array(ch.string()),
    ScopeSchemaUrl: ch.string(),
    ScopeName: ch.string(),
    ScopeVersion: ch.string(),
    ScopeAttributesJson: ch.string(),
    ScopeAttributeKeys: ch.array(ch.string()),
    MetricName: ch.string(),
    MetricDescription: ch.string(),
    MetricUnit: ch.string(),
    MetricKind: lowCardinalityString(),
    AggregationTemporality: lowCardinalityString(),
    IsMonotonic: ch.nullable(ch.boolean()),
    PointAttributesJson: ch.string(),
    PointAttributeKeys: ch.array(ch.string()),
    StartTimeUnixNano: ch.uint64(),
    TimeUnixNano: ch.uint64(),
    TimeUnixMs: ch.occurredAt(),
    Flags: ch.uint32(),
    ValueType: lowCardinalityString(),
    ValueInt: ch.nullable(ch.int64()),
    ValueDouble: ch.nullable(ch.float64()),
    Count: ch.nullable(ch.uint64()),
    Sum: ch.nullable(ch.float64()),
    Min: ch.nullable(ch.float64()),
    Max: ch.nullable(ch.float64()),
    ExplicitBounds: ch.array(ch.float64()),
    BucketCounts: ch.array(ch.uint64()),
    ExponentialScale: ch.nullable(int32()),
    ExponentialZeroThreshold: ch.nullable(ch.float64()),
    ZeroCount: ch.nullable(ch.uint64()),
    PositiveOffset: ch.nullable(int32()),
    PositiveBucketCounts: ch.array(ch.uint64()),
    NegativeOffset: ch.nullable(int32()),
    NegativeBucketCounts: ch.array(ch.uint64()),
    SummaryQuantilesJson: ch.string(),
    CanonicalPayload: ch.string(),
    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    WrittenAt: ch.writtenAt(),
    DedupVersion: dedupVersion(),
    _retention_days: ch.uint16(),
    _size_bytes: ch.uint32(),
  },
});

/** Series metadata only, kept out of the hot row: one row per series. */
export const metricSeriesTable = defineTable({
  name: "metric_series",
  merge: replacing({ version: "LastSeenAt" }),
  sortKey: ["TenantId", "SeriesId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    SeriesId: ch.string(),
    ResourceSchemaUrl: ch.string(),
    ResourceAttributesJson: ch.string(),
    ResourceAttributeKeys: ch.array(ch.string()),
    ScopeSchemaUrl: ch.string(),
    ScopeName: ch.string(),
    ScopeVersion: ch.string(),
    ScopeAttributesJson: ch.string(),
    ScopeAttributeKeys: ch.array(ch.string()),
    MetricName: ch.string(),
    MetricDescription: ch.string(),
    MetricUnit: ch.string(),
    MetricKind: lowCardinalityString(),
    AggregationTemporality: lowCardinalityString(),
    IsMonotonic: ch.nullable(ch.boolean()),
    PointAttributesJson: ch.string(),
    PointAttributeKeys: ch.array(ch.string()),
    LastSeenAt: lastSeenAtVersion(),
    AcceptedAt: ch.acceptedAt(),
    _retention_days: ch.uint16(),
    _size_bytes: ch.uint32(),
  },
});

/**
 * One 30-second bucket, rebuilt whole from the authoritative points every time,
 * so two recomputes of the same bucket always agree.
 */
export const metricTimeRollupsTable = defineTable({
  name: "metric_time_rollups",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "SeriesId", "BucketStart"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    SeriesId: ch.string(),
    MetricName: ch.string(),
    MetricUnit: ch.string(),
    MetricKind: lowCardinalityString(),
    AggregationTemporality: lowCardinalityString(),
    IsMonotonic: ch.nullable(ch.boolean()),
    BucketStart: ch.occurredAt(),
    BucketEnd: ch.occurredAt(),
    GaugeLast: ch.nullable(ch.float64()),
    Min: ch.nullable(ch.float64()),
    Max: ch.nullable(ch.float64()),
    Sum: ch.nullable(ch.float64()),
    Count: ch.uint64(),
    ExplicitBounds: ch.array(ch.float64()),
    BucketCounts: ch.array(ch.uint64()),
    ExponentialScale: ch.nullable(int32()),
    ExponentialZeroThreshold: ch.nullable(ch.float64()),
    ZeroCount: ch.uint64(),
    PositiveOffset: int32(),
    PositiveBucketCounts: ch.array(ch.uint64()),
    NegativeOffset: int32(),
    NegativeBucketCounts: ch.array(ch.uint64()),
    ResetCount: ch.uint32(),
    GapCount: ch.uint32(),
    SourcePointCount: ch.uint32(),
    /** Frozen per bucket: receipt time only moves forward, so a later
     * recompute over a grown point set derives the same earliest acceptance. */
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
    _size_bytes: ch.uint32(),
  },
});

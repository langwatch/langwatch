import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
} from "@langwatch/clickhouse";
import { z } from "zod";

/**
 * The three tables this pipeline's projections write, as migration `00049`
 * deployed them. All three partition and expire on a customer-supplied
 * timestamp — `TimeUnixMs`, `LastSeenAt`, `BucketStart` — and `PARTITION BY`
 * is not alterable, so each names that column and its debt rather than
 * claiming an anchor the deployed table does not have.
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

/**
 * `00049` stores the two content hashes as `FixedString(64)`, which pads a
 * short value with NUL bytes instead of storing it as given, so the width is
 * part of the contract rather than a storage hint.
 */
function fixedString(width: number): ColumnDef<string> {
  const schema = z.string();
  return {
    chType: `FixedString(${width})`,
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

export const metricDataPointsTable = defineTable({
  name: "metric_data_points",
  merge: replacing({ version: "DedupVersion" }),
  sortKey: ["TenantId", "SeriesId", "TimeUnixMs", "TimeUnixNano", "PointId"],
  partition: { by: "toYearWeek(TimeUnixMs)", column: "TimeUnixMs" },
  tenant: ["TenantId"],
  ttl: { anchor: "TimeUnixMs" },
  structuralDebt: [
    {
      column: "TimeUnixMs",
      reason:
        "migration 00049 partitions and expires metric_data_points on TimeUnixMs, the point's own measurement time as the customer's process stamped it — so partition spread and retention are caller-controlled. TimeUnixMs is part of a point's identity, so moving the anchor to AcceptedAt needs a new table and a copy, not an ALTER",
    },
  ],
  columns: {
    TenantId: ch.string(),
    PointId: fixedString(64),
    SeriesId: fixedString(64),
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
  partition: { by: "toYearWeek(LastSeenAt)", column: "LastSeenAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "LastSeenAt" },
  structuralDebt: [
    {
      column: "LastSeenAt",
      reason:
        "migration 00049 makes LastSeenAt the engine version, the partition key and the TTL anchor of metric_series at once, and it holds the newest point's measurement time — customer-supplied and moving. It is not in the dedup key, so a series seen in two weeks keeps one row per week permanently; both are frozen until a new-table-and-copy re-key onto AcceptedAt",
    },
  ],
  columns: {
    TenantId: ch.string(),
    SeriesId: fixedString(64),
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
    LastSeenAt: ch.occurredAt(),
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
  partition: { by: "toYearWeek(BucketStart)", column: "BucketStart" },
  tenant: ["TenantId"],
  ttl: { anchor: "BucketStart" },
  structuralDebt: [
    {
      column: "BucketStart",
      reason:
        "migration 00049 partitions and expires metric_time_rollups on BucketStart, which is derived from the point's own measurement time, so a backdated or future-stamped point chooses the partition and the retention deadline. BucketStart is the sort key's leaf, so re-anchoring needs a new table and a copy",
    },
  ],
  columns: {
    TenantId: ch.string(),
    SeriesId: fixedString(64),
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
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
    _size_bytes: ch.uint32(),
    /** Earliest acceptance of the points that built the bucket (migration
     * 00067); bookkeeping only, since 00049 anchors structure on BucketStart. */
    AcceptedAt: ch.acceptedAt(),
  },
});

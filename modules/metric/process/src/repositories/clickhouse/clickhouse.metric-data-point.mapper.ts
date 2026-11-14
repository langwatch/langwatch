import { EventUtils, SecurityError } from "@langwatch/eventing";
import type {
  aggregationTemporalitySchema,
  MetricRollupSourcePoint,
  MetricSequencePoint,
  CanonicalMetricDataPoint,
  MetricRollupRow,
  metricKindSchema,
} from "@langwatch/metric-contract";
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

/**
 * A DateTime64(3) column value. The ClickHouse client serialises a `Date`;
 * an instant serialises to an empty object, so the conversion lives here.
 */
function clickHouseTimestamp(epochMs: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

/**
 * ReplacingMergeTree keeps largest version; inverting acceptance makes first retry win.
 * On metric_usage_estimates this holds within a month (partitioned by AcceptedAt);
 * cross-month dedup at query time (see KNOWN TENSION in migration 00049).
 */
const MAX_UINT64 = 18_446_744_073_709_551_615n;

/** A UInt64 or Int64 cell: JSON quotes 64-bit integers unless the server is told otherwise. */
const wideInteger = z.union([z.string(), z.number()]);

/** Enum cells pass through unchecked, as main read them: a rollup never stops on an old row. */
const storedMetricKind = z.custom<z.infer<typeof metricKindSchema>>();
const storedTemporality = z.custom<z.infer<typeof aggregationTemporalitySchema>>();
const storedValueType = z.custom<CanonicalMetricDataPoint["valueType"]>();

/**
 * A row of the seek selection (clickhouse.metric-data-point-query.mapper.ts): order, bucket and
 * predecessor dependency only. `TimeMs` is TimeUnixMs as epoch milliseconds.
 */
export const seekMetricRowSchema = z.object({
  SeriesId: z.string(),
  PointId: z.string(),
  TimeMs: wideInteger,
  TimeUnixNano: wideInteger,
  MetricKind: storedMetricKind,
  AggregationTemporality: storedTemporality,
});
export type SeekMetricRow = z.infer<typeof seekMetricRowSchema>;

/**
 * A row of the payload selection: what a rollup is made of, a strict subset of the raw row,
 * with the version FINAL would have kept the newest of. The count columns are checked by
 * {@link countsColumn}, which names the row it refuses.
 */
export const rollupSourceRowSchema = z.object({
  TenantId: z.string(),
  PointId: z.string(),
  SeriesId: z.string(),
  MetricName: z.string(),
  MetricUnit: z.string(),
  MetricKind: storedMetricKind,
  AggregationTemporality: storedTemporality,
  IsMonotonic: z.union([z.boolean(), z.number()]).nullable(),
  StartTimeUnixNano: wideInteger,
  TimeUnixNano: wideInteger,
  TimeMs: wideInteger,
  ValueType: storedValueType,
  ValueInt: wideInteger.nullable(),
  ValueDouble: z.number().nullable(),
  Count: wideInteger.nullable(),
  Sum: z.number().nullable(),
  Min: z.number().nullable(),
  Max: z.number().nullable(),
  ExplicitBounds: z.array(z.number()),
  BucketCounts: z.unknown().optional(),
  ExponentialScale: z.number().nullable(),
  ExponentialZeroThreshold: z.number().nullable(),
  ZeroCount: wideInteger.nullable(),
  PositiveOffset: z.number().nullable(),
  PositiveBucketCounts: z.unknown().optional(),
  NegativeOffset: z.number().nullable(),
  NegativeBucketCounts: z.unknown().optional(),
  DedupVersion: wideInteger,
});
export type RollupSourceRow = z.infer<typeof rollupSourceRowSchema>;

/**
 * One of the three Array(UInt64) count columns, refusing rows without it. Validates
 * before dereference (prevents "Cannot read properties of undefined"). Error names
 * column and row for diagnostics; degrades to generic failure with trace id.
 */
function countsColumn({
  row,
  column,
}: {
  row: {
    SeriesId: string;
    PointId: string;
    BucketCounts?: unknown;
    PositiveBucketCounts?: unknown;
    NegativeBucketCounts?: unknown;
  };
  column: "BucketCounts" | "PositiveBucketCounts" | "NegativeBucketCounts";
}): string[] {
  const counts = row[column];
  if (!Array.isArray(counts)) {
    const problem =
      counts === undefined
        ? `is missing the ${column} column`
        : `carries a non-array ${typeof counts} in the ${column} column`;
    throw new Error(
      `metric_data_points row ${problem} (series ${row.SeriesId ?? "unknown"}, point ${row.PointId ?? "unknown"}); a read returned a row this decoder cannot trust`,
    );
  }
  return counts.map(String);
}

export function firstAcceptanceWinsVersion(acceptedAt: number): string {
  return (MAX_UINT64 - BigInt(acceptedAt)).toString();
}

export function metricRawRow({
  point,
  retentionDays,
}: {
  point: CanonicalMetricDataPoint;
  retentionDays: number;
}): {
  TenantId: string;
  PointId: string;
  SeriesId: string;
  ResourceSchemaUrl: string;
  ResourceAttributesJson: string;
  ResourceAttributeKeys: string[];
  ScopeSchemaUrl: string;
  ScopeName: string;
  ScopeVersion: string;
  ScopeAttributesJson: string;
  ScopeAttributeKeys: string[];
  MetricName: string;
  MetricDescription: string;
  MetricUnit: string;
  MetricKind: CanonicalMetricDataPoint["metricKind"];
  AggregationTemporality: CanonicalMetricDataPoint["aggregationTemporality"];
  IsMonotonic: boolean | null;
  PointAttributesJson: string;
  PointAttributeKeys: string[];
  StartTimeUnixNano: string;
  TimeUnixNano: string;
  TimeUnixMs: Date;
  Flags: number;
  ValueType: CanonicalMetricDataPoint["valueType"];
  ValueInt: string | null;
  ValueDouble: number | null;
  Count: string | null;
  Sum: number | null;
  Min: number | null;
  Max: number | null;
  ExplicitBounds: number[];
  BucketCounts: string[];
  ExponentialScale: number | null;
  ExponentialZeroThreshold: number | null;
  ZeroCount: string | null;
  PositiveOffset: number | null;
  PositiveBucketCounts: string[];
  NegativeOffset: number | null;
  NegativeBucketCounts: string[];
  SummaryQuantilesJson: string;
  CanonicalPayload: string;
  OccurredAt: Date;
  AcceptedAt: Date;
  DedupVersion: string;
  _retention_days: number;
  _size_bytes: number;
} {
  return {
    TenantId: point.tenantId,
    PointId: point.pointId,
    SeriesId: point.seriesId,
    ResourceSchemaUrl: point.resourceSchemaUrl,
    ResourceAttributesJson: point.resourceAttributesJson,
    ResourceAttributeKeys: point.resourceAttributeKeys,
    ScopeSchemaUrl: point.scopeSchemaUrl,
    ScopeName: point.scopeName,
    ScopeVersion: point.scopeVersion,
    ScopeAttributesJson: point.scopeAttributesJson,
    ScopeAttributeKeys: point.scopeAttributeKeys,
    MetricName: point.metricName,
    MetricDescription: point.metricDescription,
    MetricUnit: point.metricUnit,
    MetricKind: point.metricKind,
    AggregationTemporality: point.aggregationTemporality,
    IsMonotonic: point.isMonotonic,
    PointAttributesJson: point.pointAttributesJson,
    PointAttributeKeys: point.pointAttributeKeys,
    StartTimeUnixNano: point.startTimeUnixNano,
    TimeUnixNano: point.timeUnixNano,
    TimeUnixMs: clickHouseTimestamp(point.timeUnixMs),
    Flags: point.flags,
    ValueType: point.valueType,
    ValueInt: point.valueInt,
    ValueDouble: point.valueDouble,
    Count: point.count,
    Sum: point.sum,
    Min: point.min,
    Max: point.max,
    ExplicitBounds: point.explicitBounds,
    BucketCounts: point.bucketCounts,
    ExponentialScale: point.exponentialScale,
    ExponentialZeroThreshold: point.exponentialZeroThreshold,
    ZeroCount: point.zeroCount,
    PositiveOffset: point.positiveOffset,
    PositiveBucketCounts: point.positiveBucketCounts,
    NegativeOffset: point.negativeOffset,
    NegativeBucketCounts: point.negativeBucketCounts,
    SummaryQuantilesJson: point.summaryQuantilesJson,
    CanonicalPayload: point.canonicalPayload,
    OccurredAt: clickHouseTimestamp(point.occurredAt),
    AcceptedAt: clickHouseTimestamp(point.acceptedAt),
    // Keep the first acceptance when the same PointId is retried.
    DedupVersion: firstAcceptanceWinsVersion(point.acceptedAt),
    _retention_days: retentionDays,
    _size_bytes: point.canonicalSizeBytes,
  };
}

export function metricSeriesRow({
  point,
  retentionDays,
}: {
  point: CanonicalMetricDataPoint;
  retentionDays: number;
}): {
  TenantId: string;
  SeriesId: string;
  ResourceSchemaUrl: string;
  ResourceAttributesJson: string;
  ResourceAttributeKeys: string[];
  ScopeSchemaUrl: string;
  ScopeName: string;
  ScopeVersion: string;
  ScopeAttributesJson: string;
  ScopeAttributeKeys: string[];
  MetricName: string;
  MetricDescription: string;
  MetricUnit: string;
  MetricKind: CanonicalMetricDataPoint["metricKind"];
  AggregationTemporality: CanonicalMetricDataPoint["aggregationTemporality"];
  IsMonotonic: boolean | null;
  PointAttributesJson: string;
  PointAttributeKeys: string[];
  LastSeenAt: Date;
  _retention_days: number;
  _size_bytes: number;
} {
  return {
    TenantId: point.tenantId,
    SeriesId: point.seriesId,
    ResourceSchemaUrl: point.resourceSchemaUrl,
    ResourceAttributesJson: point.resourceAttributesJson,
    ResourceAttributeKeys: point.resourceAttributeKeys,
    ScopeSchemaUrl: point.scopeSchemaUrl,
    ScopeName: point.scopeName,
    ScopeVersion: point.scopeVersion,
    ScopeAttributesJson: point.scopeAttributesJson,
    ScopeAttributeKeys: point.scopeAttributeKeys,
    MetricName: point.metricName,
    MetricDescription: point.metricDescription,
    MetricUnit: point.metricUnit,
    MetricKind: point.metricKind,
    AggregationTemporality: point.aggregationTemporality,
    IsMonotonic: point.isMonotonic,
    PointAttributesJson: point.pointAttributesJson,
    PointAttributeKeys: point.pointAttributeKeys,
    LastSeenAt: clickHouseTimestamp(point.timeUnixMs),
    _retention_days: retentionDays,
    _size_bytes: 0,
  };
}

/**
 * The shadow ledger carries identifiers and source-byte counts only: never
 * attributes, values, buckets or payloads.
 */
export function metricUsageEstimateRow(point: CanonicalMetricDataPoint): {
  OrganizationId: string;
  TenantId: string;
  PointId: string;
  SeriesId: string;
  MetricName: string;
  AcceptedAt: Date;
  AcceptedHour: Date;
  CanonicalSourceBytes: number;
  DedupVersion: string;
} {
  return {
    OrganizationId: point.organizationId,
    TenantId: point.tenantId,
    PointId: point.pointId,
    SeriesId: point.seriesId,
    MetricName: point.metricName,
    AcceptedAt: clickHouseTimestamp(point.acceptedAt),
    AcceptedHour: clickHouseTimestamp(Math.floor(point.acceptedAt / 3_600_000) * 3_600_000),
    CanonicalSourceBytes: point.canonicalSizeBytes,
    DedupVersion: firstAcceptanceWinsVersion(point.acceptedAt),
  };
}

export function metricRollupRow({
  row,
  retentionDays,
}: {
  row: MetricRollupRow;
  retentionDays: number;
}): {
  TenantId: string;
  SeriesId: string;
  MetricName: string;
  MetricUnit: string;
  MetricKind: MetricRollupRow["metricKind"];
  AggregationTemporality: MetricRollupRow["aggregationTemporality"];
  IsMonotonic: boolean | null;
  BucketStart: Date;
  BucketEnd: Date;
  GaugeLast: number | null;
  Min: number | null;
  Max: number | null;
  Sum: number | null;
  Count: string;
  ExplicitBounds: number[];
  BucketCounts: string[];
  ExponentialScale: number | null;
  ExponentialZeroThreshold: number | null;
  ZeroCount: string;
  PositiveOffset: number;
  PositiveBucketCounts: string[];
  NegativeOffset: number;
  NegativeBucketCounts: string[];
  ResetCount: number;
  GapCount: number;
  SourcePointCount: number;
  UpdatedAt: Date;
  _retention_days: number;
  _size_bytes: number;
} {
  return {
    TenantId: row.tenantId,
    SeriesId: row.seriesId,
    MetricName: row.metricName,
    MetricUnit: row.metricUnit,
    MetricKind: row.metricKind,
    AggregationTemporality: row.aggregationTemporality,
    IsMonotonic: row.isMonotonic,
    BucketStart: clickHouseTimestamp(row.bucketStartMs),
    BucketEnd: clickHouseTimestamp(row.bucketEndMs),
    GaugeLast: row.gaugeLast,
    Min: row.min,
    Max: row.max,
    Sum: row.sum,
    Count: row.count,
    ExplicitBounds: row.explicitBounds,
    BucketCounts: row.bucketCounts,
    ExponentialScale: row.exponentialScale,
    ExponentialZeroThreshold: row.exponentialZeroThreshold,
    ZeroCount: row.zeroCount,
    PositiveOffset: row.positiveOffset,
    PositiveBucketCounts: row.positiveBucketCounts,
    NegativeOffset: row.negativeOffset,
    NegativeBucketCounts: row.negativeBucketCounts,
    ResetCount: row.resetCount,
    GapCount: row.gapCount,
    SourcePointCount: row.sourcePointCount,
    UpdatedAt: clickHouseTimestamp(row.updatedAt),
    _retention_days: retentionDays,
    _size_bytes: 0,
  };
}

export function metricPointFromSeekRow(row: SeekMetricRow): MetricSequencePoint {
  return {
    seriesId: row.SeriesId,
    pointId: row.PointId,
    timeUnixMs: Number(row.TimeMs),
    timeUnixNano: String(row.TimeUnixNano),
    metricKind: row.MetricKind,
    aggregationTemporality: row.AggregationTemporality,
  };
}

export function metricRollupSourceFromRow(row: RollupSourceRow): MetricRollupSourcePoint {
  return {
    tenantId: row.TenantId,
    pointId: row.PointId,
    seriesId: row.SeriesId,
    metricName: row.MetricName,
    metricUnit: row.MetricUnit,
    metricKind: row.MetricKind,
    aggregationTemporality: row.AggregationTemporality,
    isMonotonic: row.IsMonotonic === null ? null : Boolean(row.IsMonotonic),
    startTimeUnixNano: String(row.StartTimeUnixNano),
    timeUnixNano: String(row.TimeUnixNano),
    timeUnixMs: Number(row.TimeMs),
    valueType: row.ValueType,
    valueInt: row.ValueInt === null ? null : String(row.ValueInt),
    valueDouble: row.ValueDouble,
    count: row.Count === null ? null : String(row.Count),
    sum: row.Sum,
    min: row.Min,
    max: row.Max,
    explicitBounds: row.ExplicitBounds,
    bucketCounts: countsColumn({ row, column: "BucketCounts" }),
    exponentialScale: row.ExponentialScale,
    exponentialZeroThreshold: row.ExponentialZeroThreshold,
    zeroCount: row.ZeroCount === null ? null : String(row.ZeroCount),
    positiveOffset: row.PositiveOffset,
    positiveBucketCounts: countsColumn({
      row,
      column: "PositiveBucketCounts",
    }),
    negativeOffset: row.NegativeOffset,
    negativeBucketCounts: countsColumn({
      row,
      column: "NegativeBucketCounts",
    }),
  };
}

export function validateMetricPoint({
  point,
  operation,
}: {
  point: CanonicalMetricDataPoint;
  operation: string;
}): void {
  EventUtils.validateTenantId({ tenantId: point.tenantId }, operation);
  if (!/^[a-f0-9]{64}$/.test(point.pointId)) {
    throw new SecurityError({ operation, message: "invalid PointId", tenantId: point.tenantId });
  }
}

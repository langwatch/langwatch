import type {
  MetricRollupSourcePoint,
  MetricSequencePoint,
} from "~/server/event-sourcing/pipelines/metric-processing/rollup/sequence";
import type {
  AggregationTemporality,
  CanonicalMetricDataPoint,
  MetricKind,
  MetricRollupRow,
} from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";

/**
 * ReplacingMergeTree keeps the largest version, so inverting the acceptance
 * millisecond makes the first accepted retry win.
 *
 * On metric_usage_estimates this only holds within a month: that table
 * partitions by AcceptedAt, which is not part of a PointId's identity, and a
 * merge never crosses partitions. Cross-month dedup happens at query time
 * instead — see the KNOWN TENSION note in migration 00049.
 */
const MAX_UINT64 = 18_446_744_073_709_551_615n;

export function firstAcceptanceWinsVersion(acceptedAt: number): string {
  return (MAX_UINT64 - BigInt(acceptedAt)).toString();
}

export interface RawMetricRow {
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
  MetricKind: MetricKind;
  AggregationTemporality: AggregationTemporality;
  IsMonotonic: number | boolean | null;
  PointAttributesJson: string;
  PointAttributeKeys: string[];
  StartTimeUnixNano: string;
  TimeUnixNano: string;
  TimeUnixMs: string | number;
  Flags: number;
  ValueType: "none" | "int" | "double";
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
  _size_bytes: number;
  OccurredAt: string | number;
  AcceptedAt: string | number;
}

export function rawRow({
  point,
  retentionDays,
}: {
  point: CanonicalMetricDataPoint;
  retentionDays: number;
}) {
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
    TimeUnixMs: new Date(point.timeUnixMs),
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
    OccurredAt: new Date(point.occurredAt),
    AcceptedAt: new Date(point.acceptedAt),
    // Keep the first acceptance when the same PointId is retried.
    DedupVersion: firstAcceptanceWinsVersion(point.acceptedAt),
    _retention_days: retentionDays,
    _size_bytes: point.canonicalSizeBytes,
  };
}

export function seriesRow({
  point,
  retentionDays,
}: {
  point: CanonicalMetricDataPoint;
  retentionDays: number;
}) {
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
    LastSeenAt: new Date(point.timeUnixMs),
    _retention_days: retentionDays,
    _size_bytes: 0,
  };
}

/**
 * The shadow ledger carries identifiers and source-byte counts only: never
 * attributes, values, buckets or payloads.
 */
export function usageEstimateRow(point: CanonicalMetricDataPoint) {
  return {
    OrganizationId: point.organizationId,
    TenantId: point.tenantId,
    PointId: point.pointId,
    SeriesId: point.seriesId,
    MetricName: point.metricName,
    AcceptedAt: new Date(point.acceptedAt),
    AcceptedHour: new Date(
      Math.floor(point.acceptedAt / 3_600_000) * 3_600_000,
    ),
    CanonicalSourceBytes: point.canonicalSizeBytes,
    DedupVersion: firstAcceptanceWinsVersion(point.acceptedAt),
  };
}

export function rollupRow({
  row,
  retentionDays,
}: {
  row: MetricRollupRow;
  retentionDays: number;
}) {
  return {
    TenantId: row.tenantId,
    SeriesId: row.seriesId,
    MetricName: row.metricName,
    MetricUnit: row.metricUnit,
    MetricKind: row.metricKind,
    AggregationTemporality: row.aggregationTemporality,
    IsMonotonic: row.isMonotonic,
    BucketStart: new Date(row.bucketStartMs),
    BucketEnd: new Date(row.bucketEndMs),
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
    UpdatedAt: new Date(row.updatedAt),
    _retention_days: retentionDays,
    _size_bytes: 0,
  };
}

/**
 * One of the three `Array(UInt64)` count columns, refusing to decode a row that
 * does not carry it.
 *
 * These are the only fields `fromRollupRow` dereferences without a null check,
 * so a
 * row arriving without them used to surface as a bare
 * `Cannot read properties of undefined (reading 'map')` — no column, no series,
 * no query, and a stack the queue drops in favour of the message alone. Naming
 * the column and the row turns the next occurrence into evidence instead of a
 * guess. It stays a plain `Error`: nothing here is customer-actionable, so it
 * degrades to a generic failure with a trace id at the boundary and the queue
 * retries it on the normal backoff (dev/docs/best_practices/error-handling.md).
 */
function countsColumn({
  row,
  column,
}: {
  row: Pick<
    RawMetricRow,
    | "SeriesId"
    | "PointId"
    | "BucketCounts"
    | "PositiveBucketCounts"
    | "NegativeBucketCounts"
  >;
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

/**
 * The columns the rollup fold actually reads — {@link MetricRollupSourcePoint},
 * spelled as SQL.
 *
 * Dropping the payload column was not enough. `FINAL` materialises every
 * selected column for every row a seek's granules cover, not for the rows it
 * returns, and the authoritative bucket read returns on the order of a hundred
 * rows out of millions scanned. So each of the columns left out here — the two
 * attribute JSON blobs, the resource and scope identity, the description,
 * flags, the quantile JSON, the size and acceptance bookkeeping — was being
 * decompressed for every scanned row and thrown away. That is the allocation
 * the server ran out of memory inside: `Code: 241 ... (while reading column
 * PointAttributesJson)`.
 *
 * None of them is a rollup input: a rollup carries identity, kind, temporality
 * and aggregatable values, and quantiles are explicitly not aggregatable (see
 * `buildSummaryRow`). The type is what enforces that — adding a column here
 * without adding it to {@link MetricRollupSourcePoint} gains nothing, and
 * reading one in a builder without adding it here will not compile.
 */
export const ROLLUP_SELECT = `
  TenantId, PointId, SeriesId,
  MetricName, MetricUnit, MetricKind, AggregationTemporality, IsMonotonic,
  StartTimeUnixNano, TimeUnixNano, toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
  ValueType, ValueInt, ValueDouble, Count, Sum, Min, Max,
  ExplicitBounds, BucketCounts,
  ExponentialScale, ExponentialZeroThreshold, ZeroCount,
  PositiveOffset, PositiveBucketCounts, NegativeOffset, NegativeBucketCounts
`;

/** A row of {@link ROLLUP_SELECT}, which is a strict subset of the raw row. */
export type RollupSourceRow = Pick<
  RawMetricRow,
  | "TenantId"
  | "PointId"
  | "SeriesId"
  | "MetricName"
  | "MetricUnit"
  | "MetricKind"
  | "AggregationTemporality"
  | "IsMonotonic"
  | "StartTimeUnixNano"
  | "TimeUnixNano"
  | "TimeUnixMs"
  | "ValueType"
  | "ValueInt"
  | "ValueDouble"
  | "Count"
  | "Sum"
  | "Min"
  | "Max"
  | "ExplicitBounds"
  | "BucketCounts"
  | "ExponentialScale"
  | "ExponentialZeroThreshold"
  | "ZeroCount"
  | "PositiveOffset"
  | "PositiveBucketCounts"
  | "NegativeOffset"
  | "NegativeBucketCounts"
>;

export function fromRollupRow(row: RollupSourceRow): MetricRollupSourcePoint {
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
    timeUnixMs: Number(row.TimeUnixMs),
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
    positiveBucketCounts: countsColumn({ row, column: "PositiveBucketCounts" }),
    negativeOffset: row.NegativeOffset,
    negativeBucketCounts: countsColumn({ row, column: "NegativeBucketCounts" }),
  };
}

/**
 * The columns a successor seek needs: just enough to order points
 * (TimeUnixNano, PointId), locate their buckets (TimeUnixMs) and decide
 * predecessor dependency (MetricKind, AggregationTemporality). Everything else
 * — attributes, values, buckets, payload — is dead weight the seek used to
 * materialise through `FINAL` for every one of its folded branches.
 */
export const SEEK_SELECT = `
  SeriesId, PointId,
  toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs, TimeUnixNano,
  MetricKind, AggregationTemporality
`;

export interface SeekMetricRow {
  SeriesId: string;
  PointId: string;
  TimeUnixMs: string | number;
  TimeUnixNano: string;
  MetricKind: MetricKind;
  AggregationTemporality: AggregationTemporality;
}

export function fromSeekRow(row: SeekMetricRow): MetricSequencePoint {
  return {
    seriesId: row.SeriesId,
    pointId: row.PointId,
    timeUnixMs: Number(row.TimeUnixMs),
    timeUnixNano: String(row.TimeUnixNano),
    metricKind: row.MetricKind,
    aggregationTemporality: row.AggregationTemporality,
  };
}

export function validatePoint({
  point,
  operation,
}: {
  point: CanonicalMetricDataPoint;
  operation: string;
}): void {
  EventUtils.validateTenantId({ tenantId: point.tenantId }, operation);
  if (!/^[a-f0-9]{64}$/.test(point.pointId)) {
    throw new SecurityError(operation, "invalid PointId", point.tenantId);
  }
}

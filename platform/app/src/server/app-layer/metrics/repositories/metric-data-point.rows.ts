import { EventUtils, SecurityError } from "@langwatch/eventing";
import type { MetricSequencePoint } from "~/server/event-sourcing/pipelines/metric-processing/rollup/sequence";
import type {
  AggregationTemporality,
  CanonicalMetricDataPoint,
  MetricKind,
  MetricRollupRow,
} from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";

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

export const RAW_SELECT = `
  TenantId, PointId, SeriesId,
  ResourceSchemaUrl, ResourceAttributesJson, ResourceAttributeKeys,
  ScopeSchemaUrl, ScopeName, ScopeVersion, ScopeAttributesJson, ScopeAttributeKeys,
  MetricName, MetricDescription, MetricUnit, MetricKind,
  AggregationTemporality, IsMonotonic,
  PointAttributesJson, PointAttributeKeys,
  StartTimeUnixNano, TimeUnixNano, toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
  Flags, ValueType, ValueInt, ValueDouble, Count, Sum, Min, Max,
  ExplicitBounds, BucketCounts, ExponentialScale, ExponentialZeroThreshold, ZeroCount,
  PositiveOffset, PositiveBucketCounts, NegativeOffset, NegativeBucketCounts,
  SummaryQuantilesJson, CanonicalPayload, _size_bytes,
  toUnixTimestamp64Milli(OccurredAt) AS OccurredAt,
  toUnixTimestamp64Milli(AcceptedAt) AS AcceptedAt
`;

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
 * These are the only fields `fromRaw` dereferences without a null check, so a
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
 * The columns the rollup fold actually reads. Identical to {@link RAW_SELECT}
 * minus CanonicalPayload: the fold never touches the payload, and it is the
 * one megabyte-scale column, so fetching it through `FINAL` was what pushed
 * the folded seek queries past the server's per-query memory cap
 * (MEMORY_LIMIT_EXCEEDED while executing ReplacingSorted).
 */
export const AUTHORITATIVE_SELECT = RAW_SELECT.replace(
  "SummaryQuantilesJson, CanonicalPayload, _size_bytes,",
  "SummaryQuantilesJson, _size_bytes,",
);

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

export function fromRaw({
  row,
  organizationId,
}: {
  // CanonicalPayload is optional on purpose: the authoritative bucket reads
  // deliberately do not select it (see AUTHORITATIVE_SELECT), and the fold
  // never reads the decoded field.
  row: Omit<RawMetricRow, "CanonicalPayload"> & { CanonicalPayload?: string };
  organizationId: string;
}): CanonicalMetricDataPoint {
  return {
    tenantId: row.TenantId,
    // Organization identity is deliberately absent from authoritative metric
    // storage. It is carried only long enough to write the shadow ledger.
    organizationId,
    pointId: row.PointId,
    seriesId: row.SeriesId,
    resourceSchemaUrl: row.ResourceSchemaUrl,
    resourceAttributesJson: row.ResourceAttributesJson,
    resourceAttributeKeys: row.ResourceAttributeKeys,
    scopeSchemaUrl: row.ScopeSchemaUrl,
    scopeName: row.ScopeName,
    scopeVersion: row.ScopeVersion,
    scopeAttributesJson: row.ScopeAttributesJson,
    scopeAttributeKeys: row.ScopeAttributeKeys,
    metricName: row.MetricName,
    metricDescription: row.MetricDescription,
    metricUnit: row.MetricUnit,
    metricKind: row.MetricKind,
    aggregationTemporality: row.AggregationTemporality,
    isMonotonic: row.IsMonotonic === null ? null : Boolean(row.IsMonotonic),
    pointAttributesJson: row.PointAttributesJson,
    pointAttributeKeys: row.PointAttributeKeys,
    startTimeUnixNano: String(row.StartTimeUnixNano),
    timeUnixNano: String(row.TimeUnixNano),
    timeUnixMs: Number(row.TimeUnixMs),
    flags: row.Flags,
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
    summaryQuantilesJson: row.SummaryQuantilesJson,
    canonicalPayload: row.CanonicalPayload ?? "",
    canonicalSizeBytes: Number(row._size_bytes),
    occurredAt: Number(row.OccurredAt),
    acceptedAt: Number(row.AcceptedAt),
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

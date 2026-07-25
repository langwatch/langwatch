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
    AcceptedHour: new Date(Math.floor(point.acceptedAt / 3_600_000) * 3_600_000),
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

export function fromRaw({
  row,
  organizationId,
}: {
  row: RawMetricRow;
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
    bucketCounts: row.BucketCounts.map(String),
    exponentialScale: row.ExponentialScale,
    exponentialZeroThreshold: row.ExponentialZeroThreshold,
    zeroCount: row.ZeroCount === null ? null : String(row.ZeroCount),
    positiveOffset: row.PositiveOffset,
    positiveBucketCounts: row.PositiveBucketCounts.map(String),
    negativeOffset: row.NegativeOffset,
    negativeBucketCounts: row.NegativeBucketCounts.map(String),
    summaryQuantilesJson: row.SummaryQuantilesJson,
    canonicalPayload: row.CanonicalPayload,
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

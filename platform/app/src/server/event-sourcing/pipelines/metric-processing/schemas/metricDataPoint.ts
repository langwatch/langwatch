import { z } from "zod";

export const metricKindSchema = z.enum([
  "gauge",
  "sum",
  "histogram",
  "exponential_histogram",
  "summary",
]);
export type MetricKind = z.infer<typeof metricKindSchema>;

export const aggregationTemporalitySchema = z.enum([
  "unspecified",
  "delta",
  "cumulative",
]);
export type AggregationTemporality = z.infer<
  typeof aggregationTemporalitySchema
>;

/**
 * Event payload and projection record for one canonical OTLP data point.
 *
 * Integer and UInt64 values are decimal strings. This is deliberate: JS
 * numbers cannot represent every OTLP int64/fixed64 value, while ClickHouse
 * accepts decimal strings for its Int64/UInt64 columns.
 */
export const canonicalMetricDataPointSchema = z.object({
  tenantId: z.string(),
  organizationId: z.string(),
  pointId: z.string().regex(/^[a-f0-9]{64}$/),
  seriesId: z.string().regex(/^[a-f0-9]{64}$/),

  resourceSchemaUrl: z.string(),
  resourceAttributesJson: z.string(),
  resourceAttributeKeys: z.array(z.string()),
  scopeSchemaUrl: z.string(),
  scopeName: z.string(),
  scopeVersion: z.string(),
  scopeAttributesJson: z.string(),
  scopeAttributeKeys: z.array(z.string()),

  metricName: z.string(),
  metricDescription: z.string(),
  metricUnit: z.string(),
  metricKind: metricKindSchema,
  aggregationTemporality: aggregationTemporalitySchema,
  isMonotonic: z.boolean().nullable(),

  pointAttributesJson: z.string(),
  pointAttributeKeys: z.array(z.string()),
  startTimeUnixNano: z.string().regex(/^\d+$/),
  timeUnixNano: z.string().regex(/^\d+$/),
  timeUnixMs: z.number().int().nonnegative(),
  flags: z.number().int().nonnegative(),

  valueType: z.enum(["none", "int", "double"]),
  valueInt: z.string().nullable(),
  valueDouble: z.number().nullable(),
  count: z.string().nullable(),
  sum: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  explicitBounds: z.array(z.number()),
  bucketCounts: z.array(z.string()),
  exponentialScale: z.number().int().nullable(),
  exponentialZeroThreshold: z.number().nullable(),
  zeroCount: z.string().nullable(),
  positiveOffset: z.number().int().nullable(),
  positiveBucketCounts: z.array(z.string()),
  negativeOffset: z.number().int().nullable(),
  negativeBucketCounts: z.array(z.string()),
  summaryQuantilesJson: z.string(),

  canonicalPayload: z.string(),
  canonicalSizeBytes: z.number().int().nonnegative(),
  // OccurredAt is the OTLP measurement time; AcceptedAt is server receipt.
  // WrittenAt is intentionally absent here and assigned by ClickHouse.
  occurredAt: z.number().int().nonnegative(),
  acceptedAt: z.number().int().nonnegative(),
});

export type CanonicalMetricDataPoint = z.infer<
  typeof canonicalMetricDataPointSchema
>;

export interface MetricTraceCorrelation {
  tenantId: string;
  traceId: string;
  spanId: string;
  pointId: string;
  seriesId: string;
  metricName: string;
  metricUnit: string;
  metricKind: MetricKind;
  exemplarValue: number | null;
  exemplarTimeUnixMs: number;
  occurredAt: number;
}

export interface MetricRollupRow {
  tenantId: string;
  seriesId: string;
  metricName: string;
  metricUnit: string;
  metricKind: MetricKind;
  aggregationTemporality: AggregationTemporality;
  isMonotonic: boolean | null;
  bucketStartMs: number;
  bucketEndMs: number;
  gaugeLast: number | null;
  min: number | null;
  max: number | null;
  sum: number | null;
  count: string;
  explicitBounds: number[];
  bucketCounts: string[];
  exponentialScale: number | null;
  exponentialZeroThreshold: number | null;
  zeroCount: string;
  positiveOffset: number;
  positiveBucketCounts: string[];
  negativeOffset: number;
  negativeBucketCounts: string[];
  resetCount: number;
  gapCount: number;
  sourcePointCount: number;
  updatedAt: number;
}

export interface MetricUsageEstimateQuery {
  organizationId: string;
  tenantId?: string;
  metricName?: string;
  from: Date;
  to: Date;
  groupBy: "organization" | "project" | "metric" | "hour";
}

export interface MetricUsageEstimate {
  organizationId: string;
  tenantId: string | null;
  metricName: string | null;
  acceptedHour: string | null;
  uniqueActiveSeries: number;
  activeSeriesHours: number;
  acceptedPoints: number;
  canonicalRetainedBytes: number;
  projectedEventEquivalentUsage: number;
}

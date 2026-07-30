import { z } from "zod";

/**
 * The canonical shapes this pipeline moves data through: a metric data
 * point's kind, its canonicalised, lossless payload, and the derived rows
 * this pipeline's projections produce.
 *
 * Integer and UInt64 fields are decimal strings, not `number`. A JS number
 * cannot represent every OTLP int64/fixed64 value past 2^53, while a decimal
 * string both survives JSON (the event payload's wire form) and is exactly
 * what a ClickHouse Int64/UInt64 column's JSON codec accepts on the way back
 * out (`@langwatch/clickhouse`'s `ch.uint64()`/`ch.int64()`).
 */

export const metricKindSchema = z.enum([
  "gauge",
  "sum",
  "histogram",
  "exponential_histogram",
  "summary",
]);
export type MetricKind = z.infer<typeof metricKindSchema>;

const aggregationTemporalitySchema = z.enum([
  "unspecified",
  "delta",
  "cumulative",
]);
export type AggregationTemporality = z.infer<
  typeof aggregationTemporalitySchema
>;

/**
 * One canonical OTLP metric data point — the payload of the aggregate's
 * `dataPointReceived` event, and the row `metricDataPointStorage` writes.
 *
 * `valueType`/`valueInt`/`valueDouble` together are the field this pipeline's
 * zero-value guarantee is about: a gauge or sum reading of `0` is a real
 * observation, and `valueType` reports `"int"` or `"double"` for it exactly
 * as it would for any other value — see `canonical/values.ts`.
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
  // occurredAt: the OTLP measurement time (customer's clock, moves).
  // acceptedAt: server receipt time, stable across every point in one request
  // (ADR-099's `acceptedAt` role — frozen for the row's life, platform-set).
  // A store built on this data never partitions or expires on occurredAt.
  occurredAt: z.number().int().nonnegative(),
  acceptedAt: z.number().int().nonnegative(),
});

export type CanonicalMetricDataPoint = z.infer<
  typeof canonicalMetricDataPointSchema
>;

/** An exemplar that named a real trace and span — a best-effort join key. */
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

/**
 * One 30-second rollup bucket, rebuilt in full from the authoritative raw
 * points every time (never an accumulator carried forward) — the property
 * that makes `metricTimeRollup` a `map` projection rather than a `fold`
 * (ADR-098 decision 2): two computations of the same bucket from the same
 * source rows always agree, so redelivery and late-arrival recomputation are
 * both idempotent by construction, not by a delivery-mark guard.
 */
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

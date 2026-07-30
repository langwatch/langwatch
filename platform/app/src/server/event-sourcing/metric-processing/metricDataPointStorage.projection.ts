import { deriveAppendMapping } from "@langwatch/clickhouse";
import { z } from "zod";
import {
  type CanonicalMetricDataPoint,
  canonicalMetricDataPointSchema,
} from "./schema";
import { metricDataPointsTable } from "./table";

/** The map's whole job: the event's payload already is the row (ADR-105 decision 5). */
export function toMetricDataPointStorageRow(
  data: CanonicalMetricDataPoint,
): CanonicalMetricDataPoint {
  return data;
}

/** Mirrors the deployed migration's `_retention_days` column default. */
export const DEFAULT_RETENTION_DAYS = 308;

const MAX_UINT64 = (1n << 64n) - 1n;

/**
 * The engine keeps the largest version, so inverting the acceptance
 * millisecond makes the first accepted delivery of a `PointId` the one that
 * survives.
 */
export function firstAcceptanceWins(acceptedAt: number): bigint {
  return MAX_UINT64 - BigInt(acceptedAt);
}

/** A point plus the bookkeeping the store needs and the point itself does not carry. */
export const stampedPointSchema = canonicalMetricDataPointSchema.extend({
  writtenAt: z.date(),
  dedupVersion: z.bigint(),
  retentionDays: z.number().int().nonnegative(),
});

export type StampedPoint = z.infer<typeof stampedPointSchema>;

/**
 * Stamps a batch once per delivery so every row of it reports the same write
 * instant, shared by `metricDataPointStorage` and `metricSeriesCatalog`.
 */
export function stampPoints(
  batch: readonly CanonicalMetricDataPoint[],
  retentionDays: number | undefined,
): StampedPoint[] {
  const writtenAt = new Date();
  return batch.map((point) => ({
    ...point,
    writtenAt,
    dedupVersion: firstAcceptanceWins(point.acceptedAt),
    retentionDays: retentionDays ?? DEFAULT_RETENTION_DAYS,
  }));
}

/** `fill` names the columns a point carries as decimal strings, plus the two underscore columns no field is spelled for. */
export const toDataPointRow = deriveAppendMapping<
  StampedPoint,
  typeof metricDataPointsTable.columns
>({
  table: metricDataPointsTable,
  record: stampedPointSchema,
  fill: {
    StartTimeUnixNano: (point) => BigInt(point.startTimeUnixNano),
    TimeUnixNano: (point) => BigInt(point.timeUnixNano),
    ValueInt: (point) =>
      point.valueInt === null ? null : BigInt(point.valueInt),
    Count: (point) => (point.count === null ? null : BigInt(point.count)),
    BucketCounts: (point) => point.bucketCounts.map(BigInt),
    ZeroCount: (point) =>
      point.zeroCount === null ? null : BigInt(point.zeroCount),
    PositiveBucketCounts: (point) => point.positiveBucketCounts.map(BigInt),
    NegativeBucketCounts: (point) => point.negativeBucketCounts.map(BigInt),
    _retention_days: (point) => point.retentionDays,
    _size_bytes: (point) => point.canonicalSizeBytes,
  },
});

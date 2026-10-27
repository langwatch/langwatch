import { z } from "zod";

import {
  analyticsTimeseriesBucketSchema,
  type AnalyticsTimeseriesBucket,
} from "./analytics.timeseries.ts";

const groupedMetricsSchema = z.record(z.string(), z.record(z.string(), z.number()));

export interface SeriesPoint {
  timestamp: string;
  value: number;
}

/**
 * Reads a numeric series from an ungrouped result; a missing key reads 0.
 * Per-group values are never summed into one (that adds averages): a reader
 * that needs one value per bucket queries without `groupBy`.
 */
export function extractSeriesPoints(
  buckets: AnalyticsTimeseriesBucket[],
  bucketKey: string,
): SeriesPoint[] {
  return buckets.map((bucket) => {
    const value = bucket[bucketKey];
    return { timestamp: bucket.date, value: typeof value === "number" ? value : 0 };
  });
}

export function extractGroupTotals(
  buckets: AnalyticsTimeseriesBucket[],
  bucketKey: string,
  groupBy: string,
): { label: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const bucket of buckets) {
    const groups = extractGroups(bucket, groupBy);
    if (!groups) continue;
    for (const [label, metrics] of Object.entries(groups)) {
      const value = metrics[bucketKey];
      if (typeof value === "number") totals.set(label, (totals.get(label) ?? 0) + value);
    }
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .toSorted((left, right) => right.value - left.value);
}

export function aggregateSeriesValues(
  values: number[],
  aggregation: string,
  bucketCount: number,
): number {
  if (bucketCount === 0 || values.length === 0) return 0;
  if (["cardinality", "terms", "count"].includes(aggregation)) {
    return values.reduce((left, right) => left + right, 0);
  }
  return values.reduce((left, right) => left + right, 0) / values.length;
}

function extractGroups(
  bucket: AnalyticsTimeseriesBucket,
  groupBy: string,
): Record<string, Record<string, number>> | undefined {
  const parsedBucket = analyticsTimeseriesBucketSchema.safeParse(bucket);
  if (!parsedBucket.success) return void 0;

  const parsedGroups = groupedMetricsSchema.safeParse(parsedBucket.data[groupBy]);
  return parsedGroups.success ? parsedGroups.data : void 0;
}

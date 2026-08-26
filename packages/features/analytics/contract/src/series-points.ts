import { z } from "zod";

import {
  analyticsTimeseriesBucketSchema,
  type AnalyticsTimeseriesBucket,
} from "./analytics.timeseries";

const groupedMetricsSchema = z.record(z.string(), z.record(z.string(), z.number()));

export interface SeriesPoint {
  timestamp: string;
  value: number;
}

/** Reads a numeric series from ordinary and grouped analytics buckets. */
export function extractSeriesPoints(
  buckets: AnalyticsTimeseriesBucket[],
  bucketKey: string,
  groupBy?: string,
): SeriesPoint[] {
  return buckets.map((bucket) => {
    const direct = bucket[bucketKey];
    if (typeof direct === "number") return { timestamp: bucket.date, value: direct };
    const grouped = groupBy ? sumMetricAcrossGroups(bucket, groupBy, bucketKey) : void 0;
    return { timestamp: bucket.date, value: grouped ?? 0 };
  });
}

export function sumMetricAcrossGroups(
  bucket: AnalyticsTimeseriesBucket,
  groupBy: string,
  seriesKey: string,
): number | undefined {
  const groups = groupsOf(bucket, groupBy);
  if (!groups) return void 0;
  let sum = 0;
  let found = false;
  for (const metrics of Object.values(groups)) {
    const value = metrics[seriesKey];
    if (typeof value === "number") {
      sum += value;
      found = true;
    }
  }
  return found ? sum : void 0;
}

export function extractGroupTotals(
  buckets: AnalyticsTimeseriesBucket[],
  bucketKey: string,
  groupBy: string,
): Array<{ label: string; value: number }> {
  const totals = new Map<string, number>();
  for (const bucket of buckets) {
    const groups = groupsOf(bucket, groupBy);
    if (!groups) continue;
    for (const [label, metrics] of Object.entries(groups)) {
      const value = metrics[bucketKey];
      if (typeof value === "number") totals.set(label, (totals.get(label) ?? 0) + value);
    }
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
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

function groupsOf(
  bucket: AnalyticsTimeseriesBucket,
  groupBy: string,
): Record<string, Record<string, number>> | undefined {
  const parsedBucket = analyticsTimeseriesBucketSchema.safeParse(bucket);
  if (!parsedBucket.success) return void 0;

  const parsedGroups = groupedMetricsSchema.safeParse(parsedBucket.data[groupBy]);
  return parsedGroups.success ? parsedGroups.data : void 0;
}

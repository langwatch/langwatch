import { METRIC_ROLLUP_INTERVAL_MS } from "../constants";
import type { CanonicalMetricDataPoint, MetricRollupRow } from "../schema";
import { bigint, isGap } from "./sequence";

/** One point of a bucket, alongside its index into the whole ordered series. */
export interface BucketEntry {
  point: CanonicalMetricDataPoint;
  index: number;
}

export function baseRow(args: {
  point: CanonicalMetricDataPoint;
  bucketStartMs: number;
}): MetricRollupRow {
  const { point, bucketStartMs } = args;
  return {
    tenantId: point.tenantId,
    seriesId: point.seriesId,
    metricName: point.metricName,
    metricUnit: point.metricUnit,
    metricKind: point.metricKind,
    aggregationTemporality: point.aggregationTemporality,
    isMonotonic: point.isMonotonic,
    bucketStartMs,
    bucketEndMs: bucketStartMs + METRIC_ROLLUP_INTERVAL_MS,
    gaugeLast: null,
    min: null,
    max: null,
    sum: null,
    count: "0",
    explicitBounds: [],
    bucketCounts: [],
    exponentialScale: null,
    exponentialZeroThreshold: null,
    zeroCount: "0",
    positiveOffset: 0,
    positiveBucketCounts: [],
    negativeOffset: 0,
    negativeBucketCounts: [],
    resetCount: 0,
    gapCount: 0,
    sourcePointCount: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Folds one more sample into the row's running min/max/sum/count. `value`
 * is checked with `=== null`, never a truthiness test, so a genuine `0`
 * observation moves `sum` and `count` exactly like any other value.
 */
export function addStats(row: MetricRollupRow, value: number | null): void {
  if (value === null || !Number.isFinite(value)) return;
  row.min = row.min === null ? value : Math.min(row.min, value);
  row.max = row.max === null ? value : Math.max(row.max, value);
  row.sum = (row.sum ?? 0) + value;
  row.count = (bigint(row.count) + 1n).toString();
}

export function resetOrGap(args: {
  row: MetricRollupRow;
  previous: CanonicalMetricDataPoint | undefined;
  current: CanonicalMetricDataPoint;
}): void {
  const { row, previous, current } = args;
  if (isGap(previous, current)) row.gapCount++;
  else if (previous) row.resetCount++;
}

/**
 * Cumulative extrema cannot be differenced, so they only enter a rollup when
 * the point itself represents the whole new (or reset) interval.
 */
export function extendExtrema(args: {
  row: MetricRollupRow;
  point: CanonicalMetricDataPoint;
}): void {
  const { row, point } = args;
  if (point.min !== null)
    row.min = row.min === null ? point.min : Math.min(row.min, point.min);
  if (point.max !== null)
    row.max = row.max === null ? point.max : Math.max(row.max, point.max);
}

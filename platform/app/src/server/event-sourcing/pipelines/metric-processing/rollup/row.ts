import { METRIC_ROLLUP_INTERVAL_MS } from "../schemas/constants";
import type {
  CanonicalMetricDataPoint,
  MetricRollupRow,
} from "../schemas/metricDataPoint";
import { bigint, isGap } from "./sequence";

/** One point of a bucket, with its index into the whole ordered series. */
export interface BucketEntry {
  point: CanonicalMetricDataPoint;
  index: number;
}

export function baseRow({
  point,
  bucketStartMs,
}: {
  point: CanonicalMetricDataPoint;
  bucketStartMs: number;
}): MetricRollupRow {
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

export function addStats(row: MetricRollupRow, value: number | null): void {
  if (value === null || !Number.isFinite(value)) return;
  row.min = row.min === null ? value : Math.min(row.min, value);
  row.max = row.max === null ? value : Math.max(row.max, value);
  row.sum = (row.sum ?? 0) + value;
  row.count = (bigint(row.count) + 1n).toString();
}

export function resetOrGap({
  row,
  previous,
  current,
}: {
  row: MetricRollupRow;
  previous: CanonicalMetricDataPoint | undefined;
  current: CanonicalMetricDataPoint;
}): void {
  if (isGap(previous, current)) row.gapCount++;
  else if (previous) row.resetCount++;
}

/**
 * Cumulative extrema cannot be differenced, so they survive into a rollup only
 * when the point itself represents the whole new (or reset) interval.
 */
export function extendExtrema({
  row,
  point,
}: {
  row: MetricRollupRow;
  point: CanonicalMetricDataPoint;
}): void {
  if (point.min !== null) {
    row.min = row.min === null ? point.min : Math.min(row.min, point.min);
  }
  if (point.max !== null) {
    row.max = row.max === null ? point.max : Math.max(row.max, point.max);
  }
}

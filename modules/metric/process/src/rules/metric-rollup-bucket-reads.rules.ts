import {
  comparePoints,
  METRIC_ROLLUP_INTERVAL_MS,
  type MetricSequencePoint,
} from "@langwatch/metric-contract";

/** One affected rollup bucket of one series, by the bucket's start. */
export interface BucketSeek {
  seriesId: string;
  start: number;
}

/**
 * A run of a series' affected buckets whose read windows touch, by the first and last bucket
 * start. Its read covers `[from - lookbackMs, to + METRIC_ROLLUP_INTERVAL_MS)`.
 */
export interface BucketReadRange {
  seriesId: string;
  from: number;
  to: number;
}

/** The table's own row order: TimeUnixMs, then TimeUnixNano and PointId. */
function storedOrder(left: MetricSequencePoint, right: MetricSequencePoint): number {
  return left.timeUnixMs - right.timeUnixMs || comparePoints(left, right);
}

/**
 * Each series' bucket windows `[start - lookbackMs, start + interval)` merged where they touch,
 * so one contiguous key range replaces a seek per bucket and no row is read twice.
 */
export function bucketReadRanges({
  seeks,
  lookbackMs,
}: {
  seeks: readonly BucketSeek[];
  lookbackMs: number;
}): BucketReadRange[] {
  const startsBySeries = new Map<string, number[]>();
  for (const { seriesId, start } of seeks) {
    const starts = startsBySeries.get(seriesId);
    if (starts) starts.push(start);
    else startsBySeries.set(seriesId, [start]);
  }
  const ranges: BucketReadRange[] = [];
  for (const [seriesId, starts] of startsBySeries) {
    let current: BucketReadRange | undefined;
    for (const start of starts.toSorted((a, b) => a - b)) {
      if (current && start - lookbackMs <= current.to + METRIC_ROLLUP_INTERVAL_MS) {
        current.to = start;
        continue;
      }
      current = { seriesId, from: start, to: start };
      ranges.push(current);
    }
  }
  return ranges;
}

/**
 * What the per-bucket seeks returned, picked from rows read by range: for each seek, the last
 * stored point in `[start - lookbackMs, start)` and every point in `[start, start + interval)`.
 */
export function pointsForBucketSeeks<T extends MetricSequencePoint>({
  seeks,
  points,
  lookbackMs,
}: {
  seeks: readonly BucketSeek[];
  points: Iterable<T>;
  lookbackMs: number;
}): T[] {
  const bySeries = new Map<string, T[]>();
  for (const point of points) {
    const existing = bySeries.get(point.seriesId);
    if (existing) existing.push(point);
    else bySeries.set(point.seriesId, [point]);
  }
  const sortedBySeries = new Map<string, T[]>();
  for (const [seriesId, seriesPoints] of bySeries) {
    sortedBySeries.set(seriesId, seriesPoints.toSorted(storedOrder));
  }

  const picked: T[] = [];
  for (const { seriesId, start } of seeks) {
    const sorted = sortedBySeries.get(seriesId) ?? [];
    const first = firstAtOrAfter({ sorted, timeUnixMs: start });
    const predecessor = sorted[first - 1];
    if (predecessor && predecessor.timeUnixMs >= start - lookbackMs) picked.push(predecessor);
    for (let index = first; index < sorted.length; index++) {
      if (sorted[index]!.timeUnixMs >= start + METRIC_ROLLUP_INTERVAL_MS) break;
      picked.push(sorted[index]!);
    }
  }
  return picked;
}

function firstAtOrAfter({
  sorted,
  timeUnixMs,
}: {
  sorted: readonly MetricSequencePoint[];
  timeUnixMs: number;
}): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]!.timeUnixMs >= timeUnixMs) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

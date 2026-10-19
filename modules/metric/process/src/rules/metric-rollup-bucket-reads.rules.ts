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

/** An exact half-open time window `[from, to)` of one series. */
export interface SeriesWindow {
  seriesId: string;
  from: number;
  to: number;
}

/**
 * Where the picked points' payload lives: per seek, `[its predecessor's time, end of bucket)`.
 * The predecessor is the last stored point before the bucket, so nothing unpicked sits between
 * them; windows that touch are merged.
 */
export function payloadWindows({
  seeks,
  picked,
}: {
  seeks: readonly BucketSeek[];
  picked: Iterable<MetricSequencePoint>;
}): SeriesWindow[] {
  const timesBySeries = new Map<string, number[]>();
  for (const { seriesId, timeUnixMs } of picked) {
    const times = timesBySeries.get(seriesId);
    if (times) times.push(timeUnixMs);
    else timesBySeries.set(seriesId, [timeUnixMs]);
  }
  const windowsBySeries = new Map<string, SeriesWindow[]>();
  for (const { seriesId, start } of seeks) {
    const before = (timesBySeries.get(seriesId) ?? []).filter((time) => time < start);
    const window = {
      seriesId,
      from: before.length > 0 ? Math.max(...before) : start,
      to: start + METRIC_ROLLUP_INTERVAL_MS,
    };
    const windows = windowsBySeries.get(seriesId);
    if (windows) windows.push(window);
    else windowsBySeries.set(seriesId, [window]);
  }
  return [...windowsBySeries.values()].flatMap((windows) => mergeTouching(windows));
}

/** One series' windows, those that overlap or touch folded into one. */
function mergeTouching(windows: readonly SeriesWindow[]): SeriesWindow[] {
  const merged: SeriesWindow[] = [];
  let current: SeriesWindow | undefined;
  for (const window of windows.toSorted((a, b) => a.from - b.from)) {
    if (current && window.from <= current.to) {
      current.to = Math.max(current.to, window.to);
      continue;
    }
    current = { ...window };
    merged.push(current);
  }
  return merged;
}

/** What FINAL returned: per (series, point), the row with the highest dedup version. */
export function newestVersions<T extends { seriesId: string; pointId: string }>({
  rows,
}: {
  rows: Iterable<{ point: T; version: bigint }>;
}): T[] {
  const newest = new Map<string, { point: T; version: bigint }>();
  for (const row of rows) {
    const key = `${row.point.seriesId}\u0000${row.point.pointId}`;
    const current = newest.get(key);
    if (!current || row.version > current.version) newest.set(key, row);
  }
  return [...newest.values()].map(({ point }) => point);
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

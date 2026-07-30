import type { CanonicalMetricDataPoint, MetricRollupRow } from "../schema";
import { buildHistogramRow } from "./explicitHistogram";
import { buildExponentialHistogramRow } from "./exponentialHistogram";
import { type BucketEntry, baseRow } from "./row";
import { buildGaugeRow, buildSumRow } from "./scalar";
import { comparePoints, floorBucket, usesPredecessor } from "./sequence";
import { buildSummaryRow } from "./summary";

const BUILDERS = {
  gauge: buildGaugeRow,
  sum: buildSumRow,
  histogram: buildHistogramRow,
  exponential_histogram: buildExponentialHistogramRow,
  summary: buildSummaryRow,
} as const;

/**
 * Builds convergent 30-second rollups from authoritative points. This is the
 * recompute half of `metricTimeRollup`'s store — the caller supplies the
 * predecessor of the first affected point as well as every point in the
 * affected buckets, so cumulative-to-delta conversion has the context it
 * needs. Running this twice over the same `points` always produces the same
 * rows, which is what makes a redelivery, a replay, and a genuine late
 * arrival all converge to one answer rather than three.
 */
export function buildMetricRollups(args: {
  points: CanonicalMetricDataPoint[];
  affectedBuckets?: ReadonlySet<number>;
}): MetricRollupRow[] {
  const { points, affectedBuckets } = args;
  const all = [...points].sort(comparePoints);
  const bucketMap = new Map<number, BucketEntry[]>();
  all.forEach((point, index) => {
    const bucket = floorBucket(point.timeUnixMs);
    if (affectedBuckets && !affectedBuckets.has(bucket)) return;
    const entries = bucketMap.get(bucket) ?? [];
    entries.push({ point, index });
    bucketMap.set(bucket, entries);
  });

  const rows: MetricRollupRow[] = [];
  for (const [bucketStartMs, entries] of [...bucketMap].sort(
    ([a], [b]) => a - b,
  )) {
    const first = entries[0]?.point;
    if (!first) continue;
    const row = baseRow({ point: first, bucketStartMs });
    row.sourcePointCount = entries.length;
    BUILDERS[first.metricKind]({ row, entries, all });
    rows.push(row);
  }
  return rows;
}

/**
 * Buckets a late point can change: its own, plus the next sample's when that
 * sample derives its value by differencing this one. Sequence dependency —
 * not temporality — decides, because summaries difference their predecessor
 * while reporting no temporality at all.
 */
export function affectedRollupBuckets(args: {
  points: CanonicalMetricDataPoint[];
  insertedPoint: CanonicalMetricDataPoint;
}): Set<number> {
  const { points, insertedPoint } = args;
  const affected = new Set([floorBucket(insertedPoint.timeUnixMs)]);
  const next = [...points]
    .filter((point) => comparePoints(point, insertedPoint) > 0)
    .sort(comparePoints)[0];
  if (!next || !usesPredecessor(next)) return affected;
  // A reset or gap severs the *value* dependency, but the next row still
  // records that it reset or gapped against whichever point now precedes it,
  // so its bucket is recomputed either way. The two buckets are fetched as
  // separate ranges, so a distant neighbour costs a second seek, not a scan
  // of everything in between.
  affected.add(floorBucket(next.timeUnixMs));
  return affected;
}

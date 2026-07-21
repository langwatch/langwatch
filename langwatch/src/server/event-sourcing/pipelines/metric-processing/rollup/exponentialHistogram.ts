import type {
  CanonicalMetricDataPoint,
  MetricRollupRow,
} from "../schemas/metricDataPoint";
import {
  absorbZeroBuckets,
  commonZeroThreshold,
  denseBuckets,
  downscaleBuckets,
  mergeMap,
  MAX_DENSE_BUCKET_SPAN,
  subtractMaps,
  type BucketMap,
} from "./exponentialBuckets";
import { extendExtrema, resetOrGap, type BucketEntry } from "./row";
import { bigint, previousPoint, startsNewSequence } from "./sequence";

/** A point re-expressed at the bucket's common scale and zero threshold. */
interface NormalizedPoint {
  positive: BucketMap;
  negative: BucketMap;
  zeroCount: bigint;
  count: bigint;
  sum: number | null;
}

/** Matches validate.ts's floor for exponential histogram scales. */
const MIN_EXPONENTIAL_SCALE = -10;

/** The common scale, zero threshold, and per-point buckets rescaled to both. */
interface CommonLayout {
  scale: number;
  threshold: number;
  downscaled: Map<string, { positive: BucketMap; negative: BucketMap }>;
}

/** Worst-case dense index span (per sign) the contributors merge to at `scale`. */
function mergedIndexSpan({
  points,
  scale,
}: {
  points: CanonicalMetricDataPoint[];
  scale: number;
}): number {
  let span = 0;
  for (const side of ["positive", "negative"] as const) {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      const counts =
        side === "positive"
          ? point.positiveBucketCounts
          : point.negativeBucketCounts;
      if (counts.length === 0) continue;
      const offset =
        (side === "positive" ? point.positiveOffset : point.negativeOffset) ??
        0;
      const divisor = 2 ** Math.max(0, (point.exponentialScale ?? 0) - scale);
      low = Math.min(low, Math.floor(offset / divisor));
      high = Math.max(high, Math.floor((offset + counts.length - 1) / divisor));
    }
    if (high >= low) span = Math.max(span, high - low + 1);
  }
  return span;
}

function selectCommonLayout(
  contributors: Map<string, CanonicalMetricDataPoint>,
): CommonLayout {
  const points = [...contributors.values()];
  let scale = Math.min(...points.map((point) => point.exponentialScale ?? 0));
  // Bucket offsets are sender-controlled int32s, so two tiny points can merge
  // into a span covering the whole int32 range. Keep halving the resolution
  // until the span fits the densification cap; denseBuckets clamps whatever
  // even the scale floor cannot absorb.
  while (
    scale > MIN_EXPONENTIAL_SCALE &&
    mergedIndexSpan({ points, scale }) > MAX_DENSE_BUCKET_SPAN
  ) {
    scale--;
  }
  const downscaled = new Map<
    string,
    { positive: BucketMap; negative: BucketMap }
  >();
  for (const [pointId, point] of contributors) {
    downscaled.set(pointId, {
      positive: downscaleBuckets({
        offset: point.positiveOffset,
        counts: point.positiveBucketCounts,
        fromScale: point.exponentialScale ?? 0,
        toScale: scale,
      }),
      negative: downscaleBuckets({
        offset: point.negativeOffset,
        counts: point.negativeBucketCounts,
        fromScale: point.exponentialScale ?? 0,
        toScale: scale,
      }),
    });
  }
  const threshold = commonZeroThreshold({
    thresholds: points.map((point) => point.exponentialZeroThreshold),
    bucketMaps: [...downscaled.values()].flatMap(({ positive, negative }) => [
      positive,
      negative,
    ]),
    scale,
  });
  return { scale, threshold, downscaled };
}

function normalizePoint({
  point,
  layout,
}: {
  point: CanonicalMetricDataPoint;
  layout: CommonLayout;
}): NormalizedPoint {
  const buckets = layout.downscaled.get(point.pointId)!;
  const positive = absorbZeroBuckets({
    buckets: buckets.positive,
    threshold: layout.threshold,
    scale: layout.scale,
  });
  const negative = absorbZeroBuckets({
    buckets: buckets.negative,
    threshold: layout.threshold,
    scale: layout.scale,
  });
  return {
    positive: positive.buckets,
    negative: negative.buckets,
    zeroCount: bigint(point.zeroCount) + positive.absorbed + negative.absorbed,
    count: bigint(point.count),
    sum: point.sum,
  };
}

/** Delta between two normalized points, or null when the sequence reset. */
function differenceExponentialPoint({
  current,
  previous,
}: {
  current: NormalizedPoint;
  previous: NormalizedPoint;
}): NormalizedPoint | null {
  const positive = subtractMaps({
    current: current.positive,
    previous: previous.positive,
  });
  const negative = subtractMaps({
    current: current.negative,
    previous: previous.negative,
  });
  const zeroCount = current.zeroCount - previous.zeroCount;
  const count = current.count - previous.count;
  if (!positive || !negative || zeroCount < 0n || count < 0n) return null;
  return {
    positive,
    negative,
    zeroCount,
    count,
    sum:
      previous.sum !== null && current.sum !== null
        ? current.sum - previous.sum
        : null,
  };
}

function usablePredecessor({
  point,
  all,
  index,
}: {
  point: CanonicalMetricDataPoint;
  all: CanonicalMetricDataPoint[];
  index: number;
}): CanonicalMetricDataPoint | undefined {
  if (point.aggregationTemporality !== "cumulative") return undefined;
  const previous = previousPoint(all, index);
  if (!previous || previous.metricKind !== "exponential_histogram") {
    return undefined;
  }
  return startsNewSequence(previous, point) ? undefined : previous;
}

/** Every point with a say in the layout: the bucket's own plus predecessors. */
function collectContributors({
  entries,
  all,
}: {
  entries: BucketEntry[];
  all: CanonicalMetricDataPoint[];
}): Map<string, CanonicalMetricDataPoint> {
  const predecessors = new Map<string, CanonicalMetricDataPoint>();
  for (const { point, index } of entries) {
    const previous = usablePredecessor({ point, all, index });
    if (previous) predecessors.set(previous.pointId, previous);
  }
  return new Map<string, CanonicalMetricDataPoint>([
    ...entries.map(
      ({ point }) => [point.pointId, point] as [string, CanonicalMetricDataPoint],
    ),
    ...predecessors,
  ]);
}

/**
 * Rolls up exponential histograms onto one scale and one zero threshold. Both
 * are chosen across every contributing point — including the predecessors that
 * cumulative points are differenced against — so the stored row is a valid
 * exponential histogram rather than a union of incompatible layouts.
 */
export function buildExponentialHistogramRow({
  row,
  entries,
  all,
}: {
  row: MetricRollupRow;
  entries: BucketEntry[];
  all: CanonicalMetricDataPoint[];
}): void {
  const layout = selectCommonLayout(collectContributors({ entries, all }));

  const positive: BucketMap = new Map();
  const negative: BucketMap = new Map();
  let zeroCount = 0n;
  let totalCount = 0n;
  let totalSum = 0;
  let hasSum = false;

  for (const { point, index } of entries) {
    let current = normalizePoint({ point, layout });
    let usesWholePoint = point.aggregationTemporality !== "cumulative";

    if (point.aggregationTemporality === "cumulative") {
      const previousRaw = usablePredecessor({ point, all, index });
      // Both sides share a threshold, so a mid-series threshold change no
      // longer forces the whole point to be counted as a reset.
      const delta = previousRaw
        ? differenceExponentialPoint({
            current,
            previous: normalizePoint({ point: previousRaw, layout }),
          })
        : null;
      if (!delta) {
        resetOrGap({ row, previous: previousPoint(all, index), current: point });
        usesWholePoint = true;
      } else {
        current = delta;
      }
    }

    mergeMap(positive, current.positive);
    mergeMap(negative, current.negative);
    zeroCount += current.zeroCount;
    totalCount += current.count;
    if (current.sum !== null) {
      totalSum += current.sum;
      hasSum = true;
    }
    if (usesWholePoint) extendExtrema({ row, point });
  }

  const densePositive = denseBuckets(positive);
  const denseNegative = denseBuckets(negative);
  row.exponentialScale = layout.scale;
  row.exponentialZeroThreshold = layout.threshold;
  row.zeroCount = zeroCount.toString();
  row.positiveOffset = densePositive.offset;
  row.positiveBucketCounts = densePositive.counts;
  row.negativeOffset = denseNegative.offset;
  row.negativeBucketCounts = denseNegative.counts;
  row.count = totalCount.toString();
  row.sum = hasSum ? totalSum : null;
}

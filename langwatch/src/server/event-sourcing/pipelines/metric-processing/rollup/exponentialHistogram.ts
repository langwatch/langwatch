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
  const predecessors = new Map<string, CanonicalMetricDataPoint>();
  for (const { point, index } of entries) {
    const previous = usablePredecessor({ point, all, index });
    if (previous) predecessors.set(previous.pointId, previous);
  }
  const contributors = new Map<string, CanonicalMetricDataPoint>([
    ...entries.map(
      ({ point }) => [point.pointId, point] as [string, CanonicalMetricDataPoint],
    ),
    ...predecessors,
  ]);

  const scale = Math.min(
    ...[...contributors.values()].map((point) => point.exponentialScale ?? 0),
  );
  const downscaled = new Map<string, { positive: BucketMap; negative: BucketMap }>();
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
    thresholds: [...contributors.values()].map(
      (point) => point.exponentialZeroThreshold,
    ),
    bucketMaps: [...downscaled.values()].flatMap(({ positive, negative }) => [
      positive,
      negative,
    ]),
    scale,
  });

  const normalize = (point: CanonicalMetricDataPoint): NormalizedPoint => {
    const buckets = downscaled.get(point.pointId)!;
    const positive = absorbZeroBuckets({
      buckets: buckets.positive,
      threshold,
      scale,
    });
    const negative = absorbZeroBuckets({
      buckets: buckets.negative,
      threshold,
      scale,
    });
    return {
      positive: positive.buckets,
      negative: negative.buckets,
      zeroCount: bigint(point.zeroCount) + positive.absorbed + negative.absorbed,
      count: bigint(point.count),
      sum: point.sum,
    };
  };

  const positive: BucketMap = new Map();
  const negative: BucketMap = new Map();
  let zeroCount = 0n;
  let totalCount = 0n;
  let totalSum = 0;
  let hasSum = false;

  for (const { point, index } of entries) {
    let current = normalize(point);
    let usesWholePoint = point.aggregationTemporality !== "cumulative";

    if (point.aggregationTemporality === "cumulative") {
      const previousRaw = usablePredecessor({ point, all, index });
      // Both sides now share a threshold, so a mid-series threshold change no
      // longer forces the whole point to be counted as a reset.
      const previous = previousRaw ? normalize(previousRaw) : null;
      const positiveDelta = previous
        ? subtractMaps({ current: current.positive, previous: previous.positive })
        : null;
      const negativeDelta = previous
        ? subtractMaps({ current: current.negative, previous: previous.negative })
        : null;
      const zeroDelta = previous ? current.zeroCount - previous.zeroCount : -1n;
      const countDelta = previous ? current.count - previous.count : -1n;
      const sumDelta =
        previous && previous.sum !== null && current.sum !== null
          ? current.sum - previous.sum
          : null;
      if (!positiveDelta || !negativeDelta || zeroDelta < 0n || countDelta < 0n) {
        resetOrGap({ row, previous: previousPoint(all, index), current: point });
        usesWholePoint = true;
      } else {
        current = {
          positive: positiveDelta,
          negative: negativeDelta,
          zeroCount: zeroDelta,
          count: countDelta,
          sum: sumDelta,
        };
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
  row.exponentialScale = scale;
  row.exponentialZeroThreshold = threshold;
  row.zeroCount = zeroCount.toString();
  row.positiveOffset = densePositive.offset;
  row.positiveBucketCounts = densePositive.counts;
  row.negativeOffset = denseNegative.offset;
  row.negativeBucketCounts = denseNegative.counts;
  row.count = totalCount.toString();
  row.sum = hasSum ? totalSum : null;
}

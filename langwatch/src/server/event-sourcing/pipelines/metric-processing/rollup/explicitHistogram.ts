import type {
  CanonicalMetricDataPoint,
  MetricRollupRow,
} from "../schemas/metricDataPoint";
import { extendExtrema, resetOrGap, type BucketEntry } from "./row";
import { bigint, previousPoint, startsNewSequence } from "./sequence";

function commonExplicitBounds(points: CanonicalMetricDataPoint[]): number[] {
  if (points.length === 0) return [];
  let common = new Set(points[0]!.explicitBounds);
  for (const point of points.slice(1)) {
    const current = new Set(point.explicitBounds);
    common = new Set([...common].filter((bound) => current.has(bound)));
  }
  return [...common].sort((a, b) => a - b);
}

/**
 * Coarsens an explicit histogram onto boundaries shared by every input. A
 * shared-boundary set is exactly mergeable: each output bucket is a union of
 * whole source buckets, never an interpolation.
 */
function coarsenExplicit({
  point,
  targetBounds,
}: {
  point: CanonicalMetricDataPoint;
  targetBounds: number[];
}): bigint[] {
  const sourceCounts = point.bucketCounts.map(bigint);
  const out = Array.from({ length: targetBounds.length + 1 }, () => 0n);
  let targetIndex = 0;
  for (let sourceIndex = 0; sourceIndex < sourceCounts.length; sourceIndex++) {
    const sourceUpper =
      point.explicitBounds[sourceIndex] ?? Number.POSITIVE_INFINITY;
    while (
      targetIndex < targetBounds.length &&
      sourceUpper > targetBounds[targetIndex]!
    ) {
      targetIndex++;
    }
    out[Math.min(targetIndex, out.length - 1)]! += sourceCounts[sourceIndex]!;
  }
  return out;
}

/** Predecessors that a cumulative point in this bucket will be differenced against. */
function usablePredecessors({
  entries,
  all,
}: {
  entries: BucketEntry[];
  all: CanonicalMetricDataPoint[];
}): CanonicalMetricDataPoint[] {
  const predecessors: CanonicalMetricDataPoint[] = [];
  for (const { point, index } of entries) {
    if (point.aggregationTemporality !== "cumulative") continue;
    const previous = previousPoint(all, index);
    if (
      !startsNewSequence(previous, point) &&
      previous?.metricKind === "histogram"
    ) {
      predecessors.push(previous);
    }
  }
  return predecessors;
}

export function buildHistogramRow({
  row,
  entries,
  all,
}: {
  row: MetricRollupRow;
  entries: BucketEntry[];
  all: CanonicalMetricDataPoint[];
}): void {
  // Cumulative points are subtracted only after both sides have been coarsened
  // onto the same exactly mergeable boundary set, so each usable predecessor
  // also gets a say in choosing that set.
  const bounds = commonExplicitBounds([
    ...entries.map(({ point }) => point),
    ...usablePredecessors({ entries, all }),
  ]);
  const merged = Array.from({ length: bounds.length + 1 }, () => 0n);
  let totalCount = 0n;
  let totalSum = 0;
  let hasSum = false;

  for (const { point, index } of entries) {
    let coarsenedCounts: bigint[] | null = null;
    let usesWholePoint = point.aggregationTemporality !== "cumulative";
    let count = bigint(point.count);
    let sum = point.sum;

    if (point.aggregationTemporality === "cumulative") {
      const previous = previousPoint(all, index);
      const starts = startsNewSequence(previous, point);
      const previousCounts =
        !starts && previous?.metricKind === "histogram"
          ? coarsenExplicit({ point: previous, targetBounds: bounds })
          : null;
      const currentCounts = coarsenExplicit({ point, targetBounds: bounds });
      const deltaCounts = previousCounts
        ? currentCounts.map((value, i) => value - previousCounts[i]!)
        : null;
      const countsDecreased = deltaCounts?.some((value) => value < 0n);
      const deltaCount = previous ? count - bigint(previous.count) : -1n;
      const deltaSum =
        previous && previous.sum !== null && sum !== null
          ? sum - previous.sum
          : null;
      if (!deltaCounts || countsDecreased || deltaCount < 0n) {
        resetOrGap({ row, previous, current: point });
        usesWholePoint = true;
      } else {
        coarsenedCounts = deltaCounts;
        count = deltaCount;
        sum = deltaSum;
      }
    }

    const coarsened =
      coarsenedCounts ?? coarsenExplicit({ point, targetBounds: bounds });
    coarsened.forEach((value, i) => (merged[i]! += value));
    totalCount += count;
    if (sum !== null) {
      totalSum += sum;
      hasSum = true;
    }
    if (usesWholePoint) extendExtrema({ row, point });
  }

  row.explicitBounds = bounds;
  row.bucketCounts = merged.map(String);
  row.count = totalCount.toString();
  row.sum = hasSum ? totalSum : null;
}

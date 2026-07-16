import { METRIC_ROLLUP_INTERVAL_MS } from "./schemas/constants";
import type {
  CanonicalMetricDataPoint,
  MetricRollupRow,
} from "./schemas/metricDataPoint";

function bigint(value: string | null | undefined): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

function numberValue(point: CanonicalMetricDataPoint): number | null {
  if (point.valueType === "double") return point.valueDouble;
  if (point.valueType === "int" && point.valueInt !== null) {
    const value = Number(point.valueInt);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function floorBucket(timeUnixMs: number): number {
  return (
    Math.floor(timeUnixMs / METRIC_ROLLUP_INTERVAL_MS) *
    METRIC_ROLLUP_INTERVAL_MS
  );
}

function comparePoints(
  left: CanonicalMetricDataPoint,
  right: CanonicalMetricDataPoint,
): number {
  const leftNano = bigint(left.timeUnixNano);
  const rightNano = bigint(right.timeUnixNano);
  if (leftNano < rightNano) return -1;
  if (leftNano > rightNano) return 1;
  return left.pointId.localeCompare(right.pointId);
}

function isGap(
  previous: CanonicalMetricDataPoint | undefined,
  current: CanonicalMetricDataPoint,
): boolean {
  return (
    !!previous &&
    current.timeUnixMs - previous.timeUnixMs > METRIC_ROLLUP_INTERVAL_MS * 2
  );
}

function startsNewSequence(
  previous: CanonicalMetricDataPoint | undefined,
  current: CanonicalMetricDataPoint,
): boolean {
  return (
    !previous ||
    previous.startTimeUnixNano !== current.startTimeUnixNano ||
    bigint(current.timeUnixNano) <= bigint(previous.timeUnixNano) ||
    isGap(previous, current)
  );
}

function baseRow(
  point: CanonicalMetricDataPoint,
  bucketStartMs: number,
): MetricRollupRow {
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

function addStats(row: MetricRollupRow, value: number | null): void {
  if (value === null || !Number.isFinite(value)) return;
  row.min = row.min === null ? value : Math.min(row.min, value);
  row.max = row.max === null ? value : Math.max(row.max, value);
  row.sum = (row.sum ?? 0) + value;
  row.count = (bigint(row.count) + 1n).toString();
}

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
function coarsenExplicit(
  point: CanonicalMetricDataPoint,
  targetBounds: number[],
  countsOverride?: bigint[],
): bigint[] {
  const sourceCounts = countsOverride ?? point.bucketCounts.map(bigint);
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

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function downscaleBuckets(args: {
  offset: number | null;
  counts: string[];
  fromScale: number;
  toScale: number;
}): Map<number, bigint> {
  const shift = Math.max(0, args.fromScale - args.toScale);
  const divisor = 2 ** shift;
  const source = args.counts.map(bigint);
  const result = new Map<number, bigint>();
  for (let i = 0; i < source.length; i++) {
    const sourceIndex = (args.offset ?? 0) + i;
    const targetIndex = floorDiv(sourceIndex, divisor);
    result.set(targetIndex, (result.get(targetIndex) ?? 0n) + source[i]!);
  }
  return result;
}

function denseBuckets(map: Map<number, bigint>): {
  offset: number;
  counts: string[];
} {
  if (map.size === 0) return { offset: 0, counts: [] };
  const indices = [...map.keys()].sort((a, b) => a - b);
  const offset = indices[0]!;
  const end = indices.at(-1)!;
  const counts: string[] = [];
  for (let index = offset; index <= end; index++) {
    counts.push((map.get(index) ?? 0n).toString());
  }
  return { offset, counts };
}

function mergeMap(
  target: Map<number, bigint>,
  source: Map<number, bigint>,
): void {
  for (const [index, count] of source) {
    target.set(index, (target.get(index) ?? 0n) + count);
  }
}

function subtractMaps(
  current: Map<number, bigint>,
  previous: Map<number, bigint>,
): Map<number, bigint> | null {
  const result = new Map<number, bigint>();
  for (const index of new Set([...current.keys(), ...previous.keys()])) {
    const delta = (current.get(index) ?? 0n) - (previous.get(index) ?? 0n);
    if (delta < 0n) return null;
    if (delta > 0n) result.set(index, delta);
  }
  return result;
}

function previousPoint(
  all: CanonicalMetricDataPoint[],
  index: number,
): CanonicalMetricDataPoint | undefined {
  return index > 0 ? all[index - 1] : undefined;
}

function resetOrGap(
  row: MetricRollupRow,
  previous: CanonicalMetricDataPoint | undefined,
  current: CanonicalMetricDataPoint,
): void {
  if (isGap(previous, current)) row.gapCount++;
  else if (previous) row.resetCount++;
}

/**
 * Builds convergent 30-second rollups from authoritative points. Callers pass
 * the predecessor of the first affected point as well as every point in the
 * affected buckets, so cumulative-to-delta conversion has the required
 * context. Quantiles intentionally never enter summary rollups.
 */
export function buildMetricRollups(
  input: CanonicalMetricDataPoint[],
  affectedBuckets?: ReadonlySet<number>,
): MetricRollupRow[] {
  const all = [...input].sort(comparePoints);
  const bucketMap = new Map<
    number,
    Array<{ point: CanonicalMetricDataPoint; index: number }>
  >();
  all.forEach((point, index) => {
    const bucket = floorBucket(point.timeUnixMs);
    if (affectedBuckets && !affectedBuckets.has(bucket)) return;
    const entries = bucketMap.get(bucket) ?? [];
    entries.push({ point, index });
    bucketMap.set(bucket, entries);
  });

  const rows: MetricRollupRow[] = [];
  for (const [bucketStart, entries] of [...bucketMap].sort(
    ([a], [b]) => a - b,
  )) {
    const first = entries[0]?.point;
    if (!first) continue;
    const row = baseRow(first, bucketStart);
    row.sourcePointCount = entries.length;

    if (first.metricKind === "gauge") {
      for (const { point } of entries) {
        addStats(row, numberValue(point));
        row.gaugeLast = numberValue(point);
      }
      rows.push(row);
      continue;
    }

    if (first.metricKind === "sum") {
      for (const { point, index } of entries) {
        const current = numberValue(point);
        if (current === null) continue;
        if (point.aggregationTemporality !== "cumulative") {
          addStats(row, current);
          continue;
        }
        const previous = previousPoint(all, index);
        const starts = startsNewSequence(previous, point);
        const previousValue = previous ? numberValue(previous) : null;
        const decreased =
          point.isMonotonic === true &&
          previousValue !== null &&
          current < previousValue;
        if (starts || decreased || previousValue === null) {
          resetOrGap(row, previous, point);
          addStats(row, current);
        } else {
          addStats(row, current - previousValue);
        }
      }
      rows.push(row);
      continue;
    }

    if (first.metricKind === "histogram") {
      const points = entries.map(({ point }) => point);
      // Cumulative points are subtracted only after both sides have been
      // coarsened onto the same exactly mergeable boundary set. Include each
      // usable predecessor when choosing that common set.
      const boundaryInputs = [...points];
      for (const { point, index } of entries) {
        if (point.aggregationTemporality !== "cumulative") continue;
        const previous = previousPoint(all, index);
        if (
          !startsNewSequence(previous, point) &&
          previous?.metricKind === "histogram"
        ) {
          boundaryInputs.push(previous);
        }
      }
      const bounds = commonExplicitBounds(boundaryInputs);
      const merged = Array.from({ length: bounds.length + 1 }, () => 0n);
      let totalCount = 0n;
      let totalSum = 0;
      let hasSum = false;
      for (const { point, index } of entries) {
        let counts = point.bucketCounts.map(bigint);
        let coarsenedCounts: bigint[] | null = null;
        let usesWholePoint = point.aggregationTemporality !== "cumulative";
        let count = bigint(point.count);
        let sum = point.sum;
        if (point.aggregationTemporality === "cumulative") {
          const previous = previousPoint(all, index);
          const starts = startsNewSequence(previous, point);
          const previousCounts =
            !starts && previous?.metricKind === "histogram"
              ? coarsenExplicit(previous, bounds)
              : null;
          const currentCounts = coarsenExplicit(point, bounds);
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
            resetOrGap(row, previous, point);
            usesWholePoint = true;
          } else {
            coarsenedCounts = deltaCounts;
            count = deltaCount;
            sum = deltaSum;
          }
        }
        const coarsened =
          coarsenedCounts ?? coarsenExplicit(point, bounds, counts);
        coarsened.forEach((value, i) => (merged[i]! += value));
        totalCount += count;
        if (sum !== null) {
          totalSum += sum;
          hasSum = true;
        }
        // Cumulative min/max cannot be differenced. Keep them only when the
        // current point itself represents the full new/reset interval.
        if (usesWholePoint && point.min !== null) {
          row.min = row.min === null ? point.min : Math.min(row.min, point.min);
        }
        if (usesWholePoint && point.max !== null) {
          row.max = row.max === null ? point.max : Math.max(row.max, point.max);
        }
      }
      row.explicitBounds = bounds;
      row.bucketCounts = merged.map(String);
      row.count = totalCount.toString();
      row.sum = hasSum ? totalSum : null;
      rows.push(row);
      continue;
    }

    if (first.metricKind === "exponential_histogram") {
      const scaleInputs = entries.map(({ point }) => point);
      for (const { point, index } of entries) {
        if (point.aggregationTemporality !== "cumulative") continue;
        const previous = previousPoint(all, index);
        if (
          !startsNewSequence(previous, point) &&
          previous?.metricKind === "exponential_histogram"
        ) {
          scaleInputs.push(previous);
        }
      }
      const scale = Math.min(
        ...scaleInputs.map((point) => point.exponentialScale ?? 0),
      );
      const zeroThresholds = new Set(
        entries.map(({ point }) => point.exponentialZeroThreshold),
      );
      const positive = new Map<number, bigint>();
      const negative = new Map<number, bigint>();
      let zeroCount = 0n;
      let totalCount = 0n;
      let totalSum = 0;
      let hasSum = false;
      for (const { point, index } of entries) {
        let pointPositive = downscaleBuckets({
          offset: point.positiveOffset,
          counts: point.positiveBucketCounts,
          fromScale: point.exponentialScale ?? 0,
          toScale: scale,
        });
        let pointNegative = downscaleBuckets({
          offset: point.negativeOffset,
          counts: point.negativeBucketCounts,
          fromScale: point.exponentialScale ?? 0,
          toScale: scale,
        });
        let pointZeroCount = bigint(point.zeroCount);
        let count = bigint(point.count);
        let sum = point.sum;
        let usesWholePoint = point.aggregationTemporality !== "cumulative";
        if (point.aggregationTemporality === "cumulative") {
          const previous = previousPoint(all, index);
          const starts = startsNewSequence(previous, point);
          const compatible =
            previous?.metricKind === "exponential_histogram" &&
            previous.exponentialZeroThreshold ===
              point.exponentialZeroThreshold;
          const previousPositive =
            !starts && compatible
              ? downscaleBuckets({
                  offset: previous.positiveOffset,
                  counts: previous.positiveBucketCounts,
                  fromScale: previous.exponentialScale ?? 0,
                  toScale: scale,
                })
              : null;
          const previousNegative =
            !starts && compatible
              ? downscaleBuckets({
                  offset: previous.negativeOffset,
                  counts: previous.negativeBucketCounts,
                  fromScale: previous.exponentialScale ?? 0,
                  toScale: scale,
                })
              : null;
          const posDelta = previousPositive
            ? subtractMaps(pointPositive, previousPositive)
            : null;
          const negDelta = previousNegative
            ? subtractMaps(pointNegative, previousNegative)
            : null;
          const zeroDelta = previous
            ? pointZeroCount - bigint(previous.zeroCount)
            : -1n;
          const countDelta = previous ? count - bigint(previous.count) : -1n;
          const sumDelta =
            previous && previous.sum !== null && sum !== null
              ? sum - previous.sum
              : null;
          if (!posDelta || !negDelta || zeroDelta < 0n || countDelta < 0n) {
            resetOrGap(row, previous, point);
            usesWholePoint = true;
          } else {
            pointPositive = posDelta;
            pointNegative = negDelta;
            pointZeroCount = zeroDelta;
            count = countDelta;
            sum = sumDelta;
          }
        }
        mergeMap(positive, pointPositive);
        mergeMap(negative, pointNegative);
        zeroCount += pointZeroCount;
        totalCount += count;
        if (sum !== null) {
          totalSum += sum;
          hasSum = true;
        }
        if (usesWholePoint && point.min !== null) {
          row.min = row.min === null ? point.min : Math.min(row.min, point.min);
        }
        if (usesWholePoint && point.max !== null) {
          row.max = row.max === null ? point.max : Math.max(row.max, point.max);
        }
      }
      const densePositive = denseBuckets(positive);
      const denseNegative = denseBuckets(negative);
      row.exponentialScale = scale;
      row.exponentialZeroThreshold =
        zeroThresholds.size === 1
          ? (zeroThresholds.values().next().value ?? null)
          : null;
      row.zeroCount = zeroCount.toString();
      row.positiveOffset = densePositive.offset;
      row.positiveBucketCounts = densePositive.counts;
      row.negativeOffset = denseNegative.offset;
      row.negativeBucketCounts = denseNegative.counts;
      row.count = totalCount.toString();
      row.sum = hasSum ? totalSum : null;
      rows.push(row);
      continue;
    }

    // OTLP summaries are cumulative even though they have no temporality
    // field. Convert count + sum to interval deltas; quantiles remain raw-only.
    if (first.metricKind === "summary") {
      let count = 0n;
      let sum = 0;
      let hasSum = false;
      for (const { point, index } of entries) {
        const currentCount = bigint(point.count);
        const previous = previousPoint(all, index);
        const starts = startsNewSequence(previous, point);
        const compatible = previous?.metricKind === "summary";
        const previousCount = compatible ? bigint(previous.count) : 0n;
        const countDelta = currentCount - previousCount;
        if (!compatible || starts || countDelta < 0n) {
          resetOrGap(row, previous, point);
          count += currentCount;
          if (point.sum !== null) {
            sum += point.sum;
            hasSum = true;
          }
        } else {
          count += countDelta;
          if (point.sum !== null && previous.sum !== null) {
            sum += point.sum - previous.sum;
            hasSum = true;
          }
        }
      }
      row.count = count.toString();
      row.sum = hasSum ? sum : null;
      rows.push(row);
    }
  }
  return rows;
}

/** Buckets a late point can change: its own and the next cumulative sample. */
export function affectedRollupBuckets(
  points: CanonicalMetricDataPoint[],
  insertedPoint: CanonicalMetricDataPoint,
): Set<number> {
  const affected = new Set([floorBucket(insertedPoint.timeUnixMs)]);
  if (insertedPoint.aggregationTemporality !== "cumulative") return affected;
  const next = [...points]
    .filter((point) => comparePoints(point, insertedPoint) > 0)
    .sort(comparePoints)[0];
  if (next) affected.add(floorBucket(next.timeUnixMs));
  return affected;
}

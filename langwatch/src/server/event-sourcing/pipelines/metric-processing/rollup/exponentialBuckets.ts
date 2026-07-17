export type BucketMap = Map<number, bigint>;

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export function downscaleBuckets({
  offset,
  counts,
  fromScale,
  toScale,
}: {
  offset: number | null;
  counts: string[];
  fromScale: number;
  toScale: number;
}): BucketMap {
  const shift = Math.max(0, fromScale - toScale);
  const divisor = 2 ** shift;
  const result: BucketMap = new Map();
  for (let i = 0; i < counts.length; i++) {
    const sourceIndex = (offset ?? 0) + i;
    const targetIndex = floorDiv(sourceIndex, divisor);
    let parsed: bigint;
    try {
      parsed = BigInt(counts[i] ?? "0");
    } catch {
      parsed = 0n;
    }
    result.set(targetIndex, (result.get(targetIndex) ?? 0n) + parsed);
  }
  return result;
}

export function denseBuckets(map: BucketMap): {
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

export function mergeMap(target: BucketMap, source: BucketMap): void {
  for (const [index, count] of source) {
    target.set(index, (target.get(index) ?? 0n) + count);
  }
}

export function subtractMaps({
  current,
  previous,
}: {
  current: BucketMap;
  previous: BucketMap;
}): BucketMap | null {
  const result: BucketMap = new Map();
  for (const index of new Set([...current.keys(), ...previous.keys()])) {
    const delta = (current.get(index) ?? 0n) - (previous.get(index) ?? 0n);
    if (delta < 0n) return null;
    if (delta > 0n) result.set(index, delta);
  }
  return result;
}

/**
 * Bounds of bucket `index` at `scale`, per the OpenTelemetry exponential
 * histogram data model: bucket i covers (base^i, base^(i+1)] where
 * base = 2^(2^-scale). Negative buckets mirror these over |value|.
 */
function bucketBounds({
  index,
  scale,
}: {
  index: number;
  scale: number;
}): { lower: number; upper: number } {
  const exponent = 2 ** -scale;
  return {
    lower: 2 ** (index * exponent),
    upper: 2 ** ((index + 1) * exponent),
  };
}

/**
 * The zero threshold a merged exponential histogram must adopt. OpenTelemetry
 * requires the largest threshold among the inputs, widened to a bucket's upper
 * boundary whenever it would otherwise bisect a populated bucket — a threshold
 * inside a bucket has no well-defined count to split.
 */
export function commonZeroThreshold({
  thresholds,
  bucketMaps,
  scale,
}: {
  thresholds: Array<number | null>;
  bucketMaps: BucketMap[];
  scale: number;
}): number {
  let threshold = Math.max(0, ...thresholds.map((value) => value ?? 0));
  for (;;) {
    let widened = threshold;
    for (const buckets of bucketMaps) {
      for (const [index, count] of buckets) {
        if (count <= 0n) continue;
        const { lower, upper } = bucketBounds({ index, scale });
        if (lower < threshold && threshold < upper) {
          widened = Math.max(widened, upper);
        }
      }
    }
    // Widening only ever raises the threshold onto an existing boundary, so the
    // fixpoint is reached in at most one pass per distinct boundary.
    if (widened === threshold) return threshold;
    threshold = widened;
  }
}

/** Folds every bucket the threshold covers into the zero count. */
export function absorbZeroBuckets({
  buckets,
  threshold,
  scale,
}: {
  buckets: BucketMap;
  threshold: number;
  scale: number;
}): { buckets: BucketMap; absorbed: bigint } {
  if (threshold <= 0) return { buckets, absorbed: 0n };
  const kept: BucketMap = new Map();
  let absorbed = 0n;
  for (const [index, count] of buckets) {
    if (bucketBounds({ index, scale }).upper <= threshold) absorbed += count;
    else kept.set(index, count);
  }
  return { buckets: kept, absorbed };
}

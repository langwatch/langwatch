import { z } from "zod";

/** How many completed jobs the queue keeps in its rolling latency sample;
 * shared between queue and tiles so the value can't drift. */
export const LATENCY_SAMPLE_SIZE = 200;

// Windowed percentiles: rolling sample can't answer P99 over the last day, so
// completions increment time-bucketed histograms shared between writer, reader, and tests.

/** Log-spaced upper bounds in ms: 1,1.5,2,3,4,6,… up to ~8.7 minutes. */
export const LATENCY_HISTOGRAM_BOUNDS_MS: readonly number[] = (() => {
  const bounds: number[] = [];
  for (let power = 1; power <= 524_288; power *= 2) {
    bounds.push(power);
    bounds.push(power * 1.5);
  }
  return bounds;
})();

/** Field for durations past the largest bound. */
export const LATENCY_HISTOGRAM_OVERFLOW_FIELD = "+Inf";

export function latencyBucketField(durationMs: number): string {
  for (const bound of LATENCY_HISTOGRAM_BOUNDS_MS) {
    if (durationMs <= bound) return String(bound);
  }
  return LATENCY_HISTOGRAM_OVERFLOW_FIELD;
}

export const LATENCY_MINUTE_BUCKET_MS = 60 * 1000;
export const LATENCY_HOUR_BUCKET_MS = 60 * 60 * 1000;
/** Minute buckets outlive the hour window they feed, with slack for skew. */
export const LATENCY_MINUTE_BUCKET_TTL_SECONDS = 2 * 60 * 60;
/** Hour buckets outlive the week window they feed. */
export const LATENCY_HOUR_BUCKET_TTL_SECONDS = 8 * 24 * 60 * 60;

export function latencyMinuteBucketKey(queueName: string, nowMs: number): string {
  return `${queueName}:gq:stats:lat-hist:m:${Math.floor(nowMs / LATENCY_MINUTE_BUCKET_MS)}`;
}

export function latencyHourBucketKey(queueName: string, nowMs: number): string {
  return `${queueName}:gq:stats:lat-hist:h:${Math.floor(nowMs / LATENCY_HOUR_BUCKET_MS)}`;
}

export function latencyAllTimeKey(queueName: string): string {
  return `${queueName}:gq:stats:lat-hist:all`;
}

/** Field-wise sum of histogram hashes, tolerant of non-numeric noise. */
export function mergeHistogramCounts(
  hashes: Record<string, string | number>[],
): Map<string, number> {
  const merged = new Map<string, number>();
  for (const hash of hashes) {
    for (const [field, raw] of Object.entries(hash)) {
      const count = Number(raw);
      if (!Number.isFinite(count) || count <= 0) continue;
      merged.set(field, (merged.get(field) ?? 0) + count);
    }
  }
  return merged;
}

/**
 * A quantile from bucketed counts: the upper bound of the bucket where the
 * cumulative count crosses the rank - a deliberate overestimate, the honest
 * direction for latency. Null means the window holds nothing, never zero.
 */
export function computePercentileFromHistogram(
  counts: Map<string, number>,
  quantile: number,
): number | null {
  let total = 0;
  for (const count of counts.values()) total += count;
  if (total === 0) return null;

  const rank = Math.ceil(total * quantile);
  let cumulative = 0;
  for (const bound of LATENCY_HISTOGRAM_BOUNDS_MS) {
    cumulative += counts.get(String(bound)) ?? 0;
    if (cumulative >= rank) return bound;
  }
  return LATENCY_HISTOGRAM_BOUNDS_MS[LATENCY_HISTOGRAM_BOUNDS_MS.length - 1]!;
}

export const latencyWindowPercentilesSchema = z.object({
  p50Ms: z.number(),
  p99Ms: z.number(),
  /** Completions the window's percentiles are computed over. */
  count: z.number(),
});
export type LatencyWindowPercentiles = z.infer<typeof latencyWindowPercentilesSchema>;

/** Per-window percentiles; a window with no completions is null. */
export const latencyWindowsSchema = z.object({
  hour: latencyWindowPercentilesSchema.nullable(),
  day: latencyWindowPercentilesSchema.nullable(),
  week: latencyWindowPercentilesSchema.nullable(),
  allTime: latencyWindowPercentilesSchema.nullable(),
});
export type LatencyWindows = z.infer<typeof latencyWindowsSchema>;

export function computeWindowPercentiles(
  counts: Map<string, number>,
): LatencyWindowPercentiles | null {
  const p50Ms = computePercentileFromHistogram(counts, 0.5);
  const p99Ms = computePercentileFromHistogram(counts, 0.99);
  if (p50Ms === null || p99Ms === null) return null;
  let count = 0;
  for (const c of counts.values()) count += c;
  return { p50Ms, p99Ms, count };
}

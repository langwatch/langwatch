/**
 * Cache-key shaping for the trace list's cached reads. Live time ranges roll forward every request,
 * so both keys bucket their window: facet values to the minute, discover to the canonical preset
 * for its span, and two viewers of the same window share one cache slot.
 */

export interface DiscoverParams {
  tenantId: string;
  timeRange: { from: number; to: number };
}

export interface FacetValuesParams {
  tenantId: string;
  timeRange: { from: number; to: number };
  facetKey: string;
  prefix?: string;
  limit: number;
  offset: number;
}

/** Bucket size for live-range time params so the cache key stabilises across rapid refetches. */
const CACHE_TIME_BUCKET_MS = 60_000;

function bucketTime(ts: number): number {
  return Math.floor(ts / CACHE_TIME_BUCKET_MS) * CACHE_TIME_BUCKET_MS;
}

/**
 * Canonical window presets the cache snaps `discover` requests to. Two viewers of "last hour"
 * seconds apart used to pay full compute twice, their timestamps differing by sub-minute drift.
 * Ordered by ascending duration, each entry taking the windows shorter than its `maxSpanMs`.
 */
const DISCOVER_WINDOW_PRESETS: ReadonlyArray<{
  /** Window spans up to this size snap to `bucketMs`. */
  maxSpanMs: number;
  /** Bucket the `to` timestamp to a multiple of this size. */
  bucketMs: number;
  /** Stable label that goes into the cache key. */
  label: string;
}> = [
  { maxSpanMs: 65 * 60_000, bucketMs: 60_000, label: "1h" }, // up to 1h: 1-min bucket
  { maxSpanMs: 6 * 3_600_000, bucketMs: 5 * 60_000, label: "6h" }, // up to 6h: 5-min bucket
  { maxSpanMs: 25 * 3_600_000, bucketMs: 30 * 60_000, label: "24h" }, // up to 24h: 30-min bucket
  { maxSpanMs: 8 * 86_400_000, bucketMs: 3_600_000, label: "7d" }, // up to 7d: 1h bucket
  {
    maxSpanMs: 32 * 86_400_000,
    bucketMs: 6 * 3_600_000,
    label: "30d",
  }, // up to 30d: 6h bucket
  {
    maxSpanMs: Number.POSITIVE_INFINITY,
    bucketMs: 86_400_000,
    label: "all",
  }, // beyond: 1d bucket
];

/**
 * Snaps an arbitrary time range to the canonical bucket for its span, returning the rounded
 * boundaries and a stable label that doubles as the cache slot identifier. Callers put the label in
 * the cache key, so two requests for the same window hit one slot whatever the client computed.
 */
export function snapToWindowPreset(timeRange: { from: number; to: number }): {
  from: number;
  to: number;
  label: string;
} {
  const span = Math.max(0, timeRange.to - timeRange.from);
  const preset =
    DISCOVER_WINDOW_PRESETS.find((p) => span <= p.maxSpanMs) ??
    DISCOVER_WINDOW_PRESETS[DISCOVER_WINDOW_PRESETS.length - 1]!;
  const to = Math.ceil(timeRange.to / preset.bucketMs) * preset.bucketMs;
  // Reconstruct `from` from the snapped span so the cache key reflects
  // the canonical window, not the original (drifty) boundaries.
  const from = to - Math.round(span / preset.bucketMs) * preset.bucketMs;

  return { from, to, label: preset.label };
}

export function facetValuesCacheKey(params: FacetValuesParams): string {
  // "Live" time ranges roll forward by milliseconds each request — bucket to the
  // minute so identical user intent hits the same cache slot.
  return [
    params.tenantId,
    params.facetKey,
    bucketTime(params.timeRange.from),
    bucketTime(params.timeRange.to),
    params.prefix ?? "",
    params.limit,
    params.offset,
  ].join("|");
}

export function discoverCacheKey(
  tenantId: string,
  snapped: ReturnType<typeof snapToWindowPreset>,
): string {
  // Include the snapped `from` alongside `to` so two requests with different actual
  // spans that happen to land in the same preset label (e.g. 15-minute and 1-hour
  // windows both classify as "1h") don't collide on one cache slot — without `from`
  // the second viewer's facets would be served for a window they aren't looking at.
  return [tenantId, snapped.label, snapped.from, snapped.to].join("|");
}

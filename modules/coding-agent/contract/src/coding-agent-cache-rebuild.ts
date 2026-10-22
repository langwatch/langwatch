/**
 * The one rule every surface asks whether a model call rebuilt the cache: the
 * session fold's count, the usage chart, the terminal note and the findings.
 */

/** Share of the cache the read must lose, and the write must re-send, to count. */
export const CACHE_REBUILD_RATIO_THRESHOLD = 0.5;
/** Below this many written tokens a rebuild is noise, not a story. */
export const CACHE_REBUILD_MIN_TOKENS = 1_000;

export interface CacheRebuildInput {
  /** What the previous call left in the cache: its read plus its write. */
  previousCachedTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * A rebuild is a call whose cache READ fell to half or less of what the
 * previous call left cached, and that wrote at least that half again. A large
 * write on top of a full read is the context growing, not a rebuild.
 */
export function isCacheRebuild({
  previousCachedTokens,
  cacheReadTokens,
  cacheCreationTokens,
}: CacheRebuildInput): boolean {
  if (previousCachedTokens <= 0) return false;
  if (cacheCreationTokens < CACHE_REBUILD_MIN_TOKENS) return false;
  const threshold = previousCachedTokens * CACHE_REBUILD_RATIO_THRESHOLD;
  return previousCachedTokens - cacheReadTokens >= threshold && cacheCreationTokens >= threshold;
}

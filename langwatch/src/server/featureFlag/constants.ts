/**
 * Feature flag configuration constants.
 *
 * @see docs/adr/005-feature-flags.md for architecture decisions
 */

/**
 * Cache TTL for feature flags in milliseconds.
 *
 * This value is used for:
 * - Server-side Redis/memory cache (StaleWhileRevalidateCache)
 * - Client-side React Query staleTime (useFeatureFlag)
 *
 * A 5-second TTL provides fast kill switch response while minimizing
 * PostHog API calls. Changes to flags propagate within 5 seconds.
 */
export const FEATURE_FLAG_CACHE_TTL_MS = 5_000;

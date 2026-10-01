/**
 * Feature flag cache configuration.
 *
 * @see ../../adrs/001-feature-flag-service-boundary.md
 */

/**
 * Cache TTL for user-facing feature flags, in milliseconds. Held for the
 * browser-facing flag surface — the client-side React Query staleTime is
 * deliberately longer (see the app's useFeatureFlag hook).
 */
export const FEATURE_FLAG_CACHE_TTL_MS = 5_000;

/**
 * Cache TTL for backend kill switches (checked on hot paths; longer TTL
 * reduces per-tenant cache fragmentation).
 */
export const KILL_SWITCH_CACHE_TTL_MS = 60_000;

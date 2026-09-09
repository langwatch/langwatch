/**
 * Feature flag cache configuration.
 *
 * @see ../../adrs/001-feature-flag-service-boundary.md
 */

/**
 * Cache TTL for user-facing feature flags in milliseconds.
 *
 * Held for the browser-facing flag surface. The client-side React Query
 * staleTime is deliberately longer; see the app's useFeatureFlag hook.
 */
export const FEATURE_FLAG_CACHE_TTL_MS = 5_000;

/**
 * Cache TTL for backend kill switches in milliseconds.
 *
 * Kill switches are checked on hot paths (per span, per event, per command).
 * They do not need second-level freshness — an operator flip taking up to
 * 60s to propagate is fine, and the longer TTL prevents per-tenant cache
 * fragmentation from stampeding the store with per-context reads under high
 * traffic.
 */
export const KILL_SWITCH_CACHE_TTL_MS = 60_000;

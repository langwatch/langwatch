/**
 * Feature flag configuration constants.
 *
 * @see dev/docs/adr/005-feature-flags.md for architecture decisions
 */

/**
 * Cache TTL for user-facing feature flags in milliseconds.
 *
 * This value is used for:
 * - Server-side Redis/memory cache (StaleWhileRevalidateCache) for frontend flags
 * - Client-side React Query staleTime (useFeatureFlag)
 *
 * A 5-second TTL provides fast feature flag toggling for the UI while keeping
 * PostHog request volume tied to active user sessions.
 */
export const FEATURE_FLAG_CACHE_TTL_MS = 5_000;

/**
 * Cache TTL for backend kill switches in milliseconds.
 *
 * Kill switches are checked on hot paths (per span, per event, per command).
 * They do not need second-level freshness — flipping a kill switch in PostHog
 * propagating in 60s is fine, and the longer TTL prevents per-tenant cache
 * fragmentation from stampeding /flags requests under high traffic.
 *
 * When local evaluation is enabled (POSTHOG_FEATURE_FLAGS_KEY), this only
 * affects the in-memory dedup window; flag values are computed in-process
 * either way.
 */
export const KILL_SWITCH_CACHE_TTL_MS = 60_000;

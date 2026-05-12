import type { FrontendFeatureFlag } from "../server/featureFlag/frontendFeatureFlags";
import { api } from "../utils/api";
import { useFeatureFlagOverrides } from "./useFeatureFlagOverrides";

// Client-side React Query staleTime — independent of the server-side
// PostHog cache TTL. The server already short-circuits with its own 5s
// cache; making the client refetch every 5s just thrashes tRPC for no
// freshness gain. 5 min keeps kill-switch propagation reasonable for an
// active session while eliminating the per-drawer-open / per-poll-tick
// re-fetch storm we observed on /traces.
export const CLIENT_FLAG_STALE_TIME_MS = 5 * 60_000;

interface UseFeatureFlagOptions {
  projectId?: string;
  organizationId?: string;
  /**
   * Set to false to disable the query (e.g., while waiting for projectId).
   * Defaults to true.
   */
  enabled?: boolean;
}

interface UseFeatureFlagResult {
  /** Whether the feature flag is enabled. Returns false while loading. */
  enabled: boolean;
  /** Whether the flag check is in progress. */
  isLoading: boolean;
}

/**
 * React hook to check if a feature flag is enabled for the current user.
 *
 * Makes a tRPC call to check the flag server-side with PostHog, with optional
 * project/organization context for targeted feature rollouts.
 *
 * ## Usage
 *
 * ```tsx
 * // Basic usage - user-level flag
 * const { enabled } = useFeatureFlag("release_ui_simulations_menu_enabled");
 *
 * // Project-level targeting
 * const { enabled } = useFeatureFlag("release_ui_simulations_menu_enabled", {
 *   projectId: project.id,
 * });
 *
 * // Conditional fetching (e.g., wait for project to load)
 * const { enabled } = useFeatureFlag("release_ui_simulations_menu_enabled", {
 *   projectId: project?.id,
 *   enabled: !!project,
 * });
 * ```
 *
 * ## Caching
 *
 * Server-side (Redis/memory) cache TTL is `FEATURE_FLAG_CACHE_TTL_MS` (5s) so
 * kill switches propagate to the backend quickly. The client-side React Query
 * staleTime is longer (5 min) — refetching every 5s on every consumer thrashed
 * tRPC during page interactions without ever beating the server cache.
 *
 * @param flag - The feature flag key (must be in FRONTEND_FEATURE_FLAGS)
 * @param options - Optional targeting and query configuration
 * @returns Object with `enabled` (boolean) and `isLoading` (boolean)
 *
 * @see dev/docs/adr/005-feature-flags.md for architecture decisions
 * @see FRONTEND_FEATURE_FLAGS for available flags
 */
export function useFeatureFlag(
  flag: FrontendFeatureFlag,
  options?: UseFeatureFlagOptions,
): UseFeatureFlagResult {
  const queryEnabled = options?.enabled ?? true;

  const overrides = useFeatureFlagOverrides();
  const override = overrides[flag];

  const { data, isLoading } = api.featureFlag.isEnabled.useQuery(
    {
      flag,
      projectId: options?.projectId,
      organizationId: options?.organizationId,
    },
    {
      staleTime: CLIENT_FLAG_STALE_TIME_MS,
      refetchOnWindowFocus: false,
      // Skip the network call when an override is set — the override wins
      // anyway, and we don't want a refetch storm while toggling in dev.
      enabled: queryEnabled && override === undefined,
      // Flag checks are mounted at app shell (MainMenu, command bar) and fire
      // alongside the page's data queries. Without splitting, an in-flight
      // tracesV2.list (~1s) would block the menu from rendering its links —
      // and the list's perceived latency would absorb the flag round-trip.
      // Run on its own connection.
      trpc: { context: { skipBatch: true } },
    },
  );

  if (override !== undefined) {
    return { enabled: override, isLoading: false };
  }

  return {
    enabled: data?.enabled ?? false,
    isLoading: queryEnabled ? isLoading : false,
  };
}

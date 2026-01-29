import { FEATURE_FLAG_CACHE_TTL_MS } from "../server/featureFlag/constants";
import type { FrontendFeatureFlag } from "../server/featureFlag/frontendFeatureFlags";
import { api } from "../utils/api";

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
 * Results are cached both server-side (Redis/memory) and client-side (React Query)
 * with a 5-second TTL. This ensures fast kill switch response while minimizing
 * API calls.
 *
 * @param flag - The feature flag key (must be in FRONTEND_FEATURE_FLAGS)
 * @param options - Optional targeting and query configuration
 * @returns Object with `enabled` (boolean) and `isLoading` (boolean)
 *
 * @see docs/adr/005-feature-flags.md for architecture decisions
 * @see FRONTEND_FEATURE_FLAGS for available flags
 */
export function useFeatureFlag(
  flag: FrontendFeatureFlag,
  options?: UseFeatureFlagOptions,
): UseFeatureFlagResult {
  const queryEnabled = options?.enabled ?? true;

  const { data, isLoading } = api.featureFlag.isEnabled.useQuery(
    {
      flag,
      targetProjectId: options?.projectId,
      targetOrganizationId: options?.organizationId,
    },
    {
      staleTime: FEATURE_FLAG_CACHE_TTL_MS,
      refetchOnWindowFocus: false,
      enabled: queryEnabled,
    },
  );

  return {
    enabled: data?.enabled ?? false,
    isLoading: queryEnabled ? isLoading : false,
  };
}

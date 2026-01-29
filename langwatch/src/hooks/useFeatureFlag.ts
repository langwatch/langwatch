import type { FrontendFeatureFlag } from "../server/featureFlag/frontendFeatureFlags";
import { api } from "../utils/api";

interface UseFeatureFlagOptions {
  projectId?: string;
  organizationId?: string;
}

interface UseFeatureFlagResult {
  enabled: boolean;
  isLoading: boolean;
}

/**
 * Hook to check if a feature flag is enabled for the current user.
 * Makes a tRPC call to check the flag with optional project/org context.
 *
 * @param flag - The feature flag to check
 * @param options - Optional project/org context for targeting
 * @returns { enabled, isLoading } - enabled is false while loading
 */
export function useFeatureFlag(
  flag: FrontendFeatureFlag,
  options?: UseFeatureFlagOptions,
): UseFeatureFlagResult {
  const { data, isLoading } = api.featureFlag.isEnabled.useQuery(
    {
      flag,
      projectId: options?.projectId,
      organizationId: options?.organizationId,
    },
    {
      staleTime: 5 * 1000, // Match server-side cache TTL
      refetchOnWindowFocus: false,
    },
  );

  return {
    enabled: data?.enabled ?? false,
    isLoading,
  };
}

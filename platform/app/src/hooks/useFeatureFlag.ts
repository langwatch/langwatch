import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
import { api } from "../utils/api";

// The service caches operator rows for five seconds. Refetching every mounted
// hook at that cadence adds traffic without making a decision fresher, so the
// browser keeps its resolved value for five minutes.
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
 * Resolves a browser-visible flag for the signed-in user and an optional
 * authorised tenant target. React Query deliberately caches longer than the
 * server's kill-switch cache to avoid repeated transport calls while mounted.
 */
export function useFeatureFlag(
  flag: FrontendFeatureFlag,
  options?: UseFeatureFlagOptions,
): UseFeatureFlagResult {
  const queryEnabled = options?.enabled ?? true;

  const { data, isLoading } = api.featureFlag.isEnabled.useQuery(
    {
      flag,
      projectId: options?.projectId,
      organizationId: options?.organizationId,
    },
    {
      staleTime: CLIENT_FLAG_STALE_TIME_MS,
      refetchOnWindowFocus: false,
      enabled: queryEnabled,
      // Flag checks are mounted at app shell (MainMenu, command bar) and fire
      // alongside the page's data queries. Without splitting, an in-flight
      // tracesV2.list (~1s) would block the menu from rendering its links —
      // and the list's perceived latency would absorb the flag round-trip.
      // Run on its own connection.
      trpc: { context: { skipBatch: true } },
    },
  );

  return {
    enabled: data?.enabled ?? false,
    isLoading: queryEnabled ? isLoading : false,
  };
}

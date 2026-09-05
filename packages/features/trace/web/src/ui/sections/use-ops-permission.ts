import { api } from "./trace-api";

// Ops scope reflects the signed-in user's grants on this project — it
// doesn't change mid-session. Without an explicit staleTime React Query
// re-fetched on every drawer open and every layout mount.
const OPS_SCOPE_STALE_TIME_MS = 5 * 60_000;

/**
 * Reports the calling user's ops access.
 */
export function useOpsPermission({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const query = api.ops.getScope.useQuery(undefined, {
    // `getScope` is protected. Surfaces that render for anonymous viewers (the
    // public share page) must opt out, or the probe 401s on every load.
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: OPS_SCOPE_STALE_TIME_MS,
  });

  const scope = query.data?.scope ?? null;
  const hasAccess = scope !== null && scope.kind !== "none";

  return {
    hasAccess,
    scope,
    isLoading: query.isLoading,
  };
}

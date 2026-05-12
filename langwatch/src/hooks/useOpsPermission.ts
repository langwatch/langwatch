import { api } from "~/utils/api";

// Ops scope reflects the signed-in user's grants on this project — it
// doesn't change mid-session. Without an explicit staleTime React Query
// re-fetched on every drawer open and every layout mount.
const OPS_SCOPE_STALE_TIME_MS = 5 * 60_000;

export function useOpsPermission() {
  const query = api.ops.getScope.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: OPS_SCOPE_STALE_TIME_MS,
  });

  return {
    hasAccess: query.isSuccess,
    scope: query.data?.scope ?? null,
    isLoading: query.isLoading,
  };
}

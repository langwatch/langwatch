import { api } from "~/utils/api";

// Ops scope reflects the signed-in user's grants on this project — it
// doesn't change mid-session. Without an explicit staleTime React Query
// re-fetched on every drawer open and every layout mount.
const OPS_SCOPE_STALE_TIME_MS = 5 * 60_000;

/**
 * Reports the calling user's ops access. The underlying `api.ops.getScope`
 * is now a status probe — it always succeeds with `scope.kind === "none"`
 * for non-ops users instead of throwing FORBIDDEN, so this hook no longer
 * spams the console on every page load (lw#3584).
 *
 * Consumers should keep using `hasAccess` to gate ops UI; the discriminator
 * is exposed via `scope.kind` for callers that want to branch on tier
 * later (e.g. ops:view vs ops:manage if that ever lands).
 */
export function useOpsPermission() {
  const query = api.ops.getScope.useQuery(undefined, {
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

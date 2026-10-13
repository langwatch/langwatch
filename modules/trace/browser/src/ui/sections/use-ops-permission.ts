import { api } from "../../behavior/trace-api.ts";

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
  });

  const scope = query.data?.scope ?? null;
  const hasAccess = scope !== null && scope.kind !== "none";

  return {
    hasAccess,
    scope,
    isLoading: query.isLoading,
  };
}

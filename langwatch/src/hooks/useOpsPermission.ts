import { api } from "~/utils/api";
import type { OpsScope } from "~/server/api/rbac";

export function useOpsPermission() {
  const query = api.ops.getScope.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const scope = (query.data?.scope as OpsScope) ?? null;

  return {
    hasAccess: query.isSuccess,
    scope,
    isLoading: query.isLoading,
  };
}

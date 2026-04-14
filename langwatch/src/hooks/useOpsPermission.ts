import { api } from "~/utils/api";
import type { OpsScope } from "~/server/api/rbac";

export function useOpsPermission() {
  const query = api.ops.getScope.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const scope = (query.data?.scope as OpsScope) ?? null;
  const canManage =
    scope?.kind === "platform" || scope?.kind === "organization";

  return {
    hasAccess: query.isSuccess,
    scope,
    canManage,
    isLoading: query.isLoading,
  };
}

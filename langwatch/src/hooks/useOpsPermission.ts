import { api } from "~/utils/api";

export function useOpsPermission() {
  const query = api.ops.getScope.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  return {
    hasAccess: query.isSuccess,
    scope: query.data?.scope ?? null,
    isLoading: query.isLoading,
  };
}

import { type AuthzPermission, permissionSatisfiedBy } from "@langwatch/authz";
import { useCallback } from "react";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * ADR-092 §5 — the client asks the server what it may do, once per
 * org+project, instead of re-deriving decisions from bundled role bags.
 * The registry types are shared, so a typo'd permission string fails the
 * build; the hierarchy helper is the same pure function the engine uses.
 *
 * `can()` returns false while loading — fail closed, unlike the legacy
 * withPermissionGuard which rendered the protected component during load.
 */
export function useCan() {
  const { project, organization } = useOrganizationTeamProject();

  const effective = api.authz.effectivePermissions.useQuery(
    {
      projectId: project?.id,
      organizationId: project?.id ? undefined : organization?.id,
    },
    {
      enabled: !!project?.id || !!organization?.id,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  );

  const can = useCallback(
    (permission: AuthzPermission): boolean => {
      const permissions = effective.data?.permissions;
      if (!permissions) return false;
      return permissionSatisfiedBy({
        granted: new Set(permissions),
        requested: permission,
      });
    },
    [effective.data?.permissions],
  );

  return {
    can,
    isLoading: effective.isLoading,
    permissions: effective.data?.permissions ?? [],
  };
}

import { type AuthzPermission, permissionSatisfiedBy } from "@langwatch/authz";
import { useCallback, useMemo } from "react";
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

  // Built once per fetched set rather than per `can()` call: a page asking
  // about a dozen permissions on every render would otherwise rebuild the
  // same ~126-entry set a dozen times.
  const granted = useMemo(
    () => new Set(effective.data?.permissions),
    [effective.data?.permissions],
  );

  const can = useCallback(
    (permission: AuthzPermission): boolean => {
      if (!effective.data?.permissions) return false;
      return permissionSatisfiedBy({ granted, requested: permission });
    },
    [granted, effective.data?.permissions],
  );

  return {
    can,
    // React Query v4 reports a DISABLED query as loading forever, and this
    // query is disabled until there is an org or a project to ask about. A
    // consumer gating its render on `isLoading` would never render at all on
    // those screens; `isInitialLoading` is the flag that means "a fetch this
    // hook actually started has not answered yet".
    isLoading: effective.isInitialLoading,
    permissions: effective.data?.permissions ?? [],
  };
}

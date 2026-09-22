import type { AuthzPermission } from "@langwatch/authz";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * ADR-092 §5 — the client asks the server what it may do, once per
 * org+project, instead of re-deriving decisions from bundled role bags.
 * The registry types are shared, so a typo'd permission string fails the
 * build. The organization hook owns the one effective-permissions read so
 * callers do not create competing role-derived decisions.
 *
 * `can()` returns false while loading — fail closed, unlike the legacy
 * withPermissionGuard which rendered the protected component during load.
 */
export function useCan() {
  const { hasPermission, permissionIsLoading, effectivePermissions } =
    useOrganizationTeamProject();

  const can = (permission: AuthzPermission): boolean =>
    hasPermission(permission);

  return {
    can,
    isLoading: permissionIsLoading,
    permissions: effectivePermissions,
  };
}

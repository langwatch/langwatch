/**
 * @deprecated This module is deprecated. Import from ./rbac instead.
 *
 * This file re-exports from the RBAC module for backward compatibility.
 * New code should import directly from ./rbac.
 */

export {
  checkOrganizationPermission,
  checkPermissionOrPubliclyShared,
  checkProjectPermission,
  checkTeamPermission,
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
  isDemoProject,
  skipPermissionCheck,
  skipPermissionCheckProjectCreation,
  type PermissionMiddleware,
} from "./rbac";

export type { Permission } from "./rbac";

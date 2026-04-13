import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type PrismaClient,
} from "@prisma/client";
import {
  hasPermissionWithHierarchy,
  organizationRoleHasPermission,
  teamRoleHasPermission,
  type Permission,
} from "../api/rbac";
// ============================================================================
// Types
// ============================================================================

export type ScopeRef =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

// ============================================================================
// Scope resolution helpers
// ============================================================================

/**
 * Returns the ordered list of scopes from most-specific to least-specific
 * for a given target scope. The resolver walks this list and picks the first
 * matching binding.
 */
function ancestorScopes(
  scope: ScopeRef,
): Array<{ type: RoleBindingScopeType; id: string }> {
  switch (scope.type) {
    case "project":
      return [
        { type: RoleBindingScopeType.PROJECT, id: scope.id },
        { type: RoleBindingScopeType.TEAM, id: scope.teamId },
        // org-level is checked separately via resolveHighestRole across all bindings
      ];
    case "team":
      return [{ type: RoleBindingScopeType.TEAM, id: scope.id }];
    case "org":
      return [{ type: RoleBindingScopeType.ORGANIZATION, id: scope.id }];
  }
}

// ============================================================================
// Core resolver
// ============================================================================

/**
 * Collects all RoleBindings for a user that are relevant to the given scope
 * (i.e. at any ancestor scope: project → team → org).
 *
 * @internal — use checkRoleBindingPermission for access-control decisions.
 */
async function collectBindingsForScope({
  prisma,
  userId,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  scope: ScopeRef;
}): Promise<Array<{ role: TeamUserRole; customRoleId: string | null; scopeType: RoleBindingScopeType }>> {
  const [directBindings, groupBindings] = await Promise.all([
    prisma.roleBinding.findMany({
      where: { organizationId, userId },
      select: { role: true, customRoleId: true, scopeType: true, scopeId: true },
    }),
    prisma.roleBinding.findMany({
      where: {
        organizationId,
        group: { members: { some: { userId } } },
      },
      select: { role: true, customRoleId: true, scopeType: true, scopeId: true },
    }),
  ]);

  const allOrgBindings = [...directBindings, ...groupBindings];

  const ancestorScopeList = ancestorScopes(scope);
  if (scope.type !== "org") {
    ancestorScopeList.push({ type: RoleBindingScopeType.ORGANIZATION, id: organizationId });
  }

  return allOrgBindings
    .filter((b) => ancestorScopeList.some((s) => s.type === b.scopeType && s.id === b.scopeId))
    .map((b) => ({ role: b.role, customRoleId: b.customRoleId, scopeType: b.scopeType }));
}

// ============================================================================
// Permission check helper
// ============================================================================

/**
 * Checks whether a user has a specific permission at a given scope.
 *
 * All matching bindings across ancestor scopes are evaluated and their
 * permission sets are unioned — the user is permitted if ANY binding grants
 * the requested permission.
 */
export async function checkRoleBindingPermission({
  prisma,
  userId,
  organizationId,
  scope,
  permission,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  scope: ScopeRef;
  permission: Permission;
}): Promise<boolean> {
  const bindings = await collectBindingsForScope({ prisma, userId, organizationId, scope });

  for (const binding of bindings) {
    // Custom role — look up its permissions
    if (binding.role === TeamUserRole.CUSTOM && binding.customRoleId) {
      const customRole = await prisma.customRole.findUnique({
        where: { id: binding.customRoleId },
        select: { permissions: true },
      });
      const perms = Array.isArray(customRole?.permissions)
        ? (customRole.permissions as string[])
        : [];
      if (perms.length > 0 && hasPermissionWithHierarchy(perms, permission)) {
        return true;
      }
      // Empty custom role — fall through to built-in VIEWER check below
    }

    // Org-scoped bindings: ADMIN grants everything; MEMBER grants org-level permissions only
    if (
      binding.scopeType === RoleBindingScopeType.ORGANIZATION &&
      binding.role !== TeamUserRole.CUSTOM
    ) {
      if (binding.role === TeamUserRole.ADMIN) return true;
      if (organizationRoleHasPermission(OrganizationUserRole.MEMBER, permission)) return true;
      continue;
    }

    if (teamRoleHasPermission(binding.role, permission)) {
      return true;
    }
  }

  return false;
}

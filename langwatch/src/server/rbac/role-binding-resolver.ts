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

/**
 * A principal is the entity whose permissions are being checked.
 * - "user": a human user (supports group memberships)
 * - "pat": a personal access token (no groups)
 */
export type Principal =
  | { type: "user"; id: string }
  | { type: "pat"; id: string };

type ResolvedBinding = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
};

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
 * Collects all RoleBindings for a principal that are relevant to the given scope
 * (i.e. at any ancestor scope: project → team → org).
 *
 * For user principals: direct bindings + group-memberships bindings.
 * For PAT principals: queries by patId only; no group expansion.
 *
 * @internal — use checkRoleBindingPermission for access-control decisions.
 */
async function collectBindingsForScope({
  prisma,
  principal,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  principal: Principal;
  organizationId: string;
  scope: ScopeRef;
}): Promise<ResolvedBinding[]> {
  if (principal.type === "pat") {
    return collectBindingsForPat({ prisma, patId: principal.id, organizationId, scope });
  }

  return collectBindingsForUser({ prisma, userId: principal.id, organizationId, scope });
}

async function collectBindingsForUser({
  prisma,
  userId,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  scope: ScopeRef;
}): Promise<ResolvedBinding[]> {
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

async function collectBindingsForPat({
  prisma,
  patId,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  patId: string;
  organizationId: string;
  scope: ScopeRef;
}): Promise<ResolvedBinding[]> {
  const bindings = await prisma.roleBinding.findMany({
    where: { organizationId, patId },
    select: { role: true, customRoleId: true, scopeType: true, scopeId: true },
  });

  if (bindings.length === 0) return [];

  const ancestorScopeList = ancestorScopes(scope);
  if (scope.type !== "org") {
    ancestorScopeList.push({ type: RoleBindingScopeType.ORGANIZATION, id: organizationId });
  }

  return bindings
    .filter((b) => ancestorScopeList.some((s) => s.type === b.scopeType && s.id === b.scopeId))
    .map((b) => ({ role: b.role, customRoleId: b.customRoleId, scopeType: b.scopeType }));
}

// ============================================================================
// Permission check helper
// ============================================================================

/**
 * Checks whether a principal has a specific permission at a given scope.
 *
 * All matching bindings across ancestor scopes are evaluated and their
 * permission sets are unioned — the principal is permitted if ANY binding grants
 * the requested permission.
 *
 * Accepts either a userId string (backwards-compatible) or a Principal object.
 */
export async function checkRoleBindingPermission({
  prisma,
  userId,
  principal,
  organizationId,
  scope,
  permission,
}: {
  prisma: PrismaClient;
  userId?: string;
  principal?: Principal;
  organizationId: string;
  scope: ScopeRef;
  permission: Permission;
}): Promise<boolean> {
  const resolvedPrincipal: Principal = principal ?? { type: "user", id: userId! };

  const bindings = await collectBindingsForScope({ prisma, principal: resolvedPrincipal, organizationId, scope });

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
      // Empty/missing custom role — fall through to the built-in CUSTOM permission
      // set below, which grants the same `*:view` permissions as a VIEWER binding.
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

/**
 * Resolution-time ceiling enforcement for PATs.
 *
 * effective_permissions = PAT.roleBindings(scope) ∩ user.roleBindings(scope)
 *
 * Returns true only if BOTH the PAT's own bindings AND the owning user's
 * current bindings grant the requested permission. If the user's role has been
 * downgraded, the PAT auto-degrades immediately.
 */
export async function resolvePatPermission({
  prisma,
  patId,
  userId,
  organizationId,
  scope,
  permission,
}: {
  prisma: PrismaClient;
  patId: string;
  userId: string;
  organizationId: string;
  scope: ScopeRef;
  permission: Permission;
}): Promise<boolean> {
  // 1. Check PAT's own bindings
  const patAllowed = await checkRoleBindingPermission({
    prisma,
    principal: { type: "pat", id: patId },
    organizationId,
    scope,
    permission,
  });
  if (!patAllowed) return false;

  // 2. Check owning user's current bindings (ceiling)
  return checkRoleBindingPermission({
    prisma,
    principal: { type: "user", id: userId },
    organizationId,
    scope,
    permission,
  });
}

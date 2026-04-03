import {
  RoleBindingScopeType,
  TeamUserRole,
  type PrismaClient,
} from "@prisma/client";
import {
  hasPermissionWithHierarchy,
  teamRoleHasPermission,
  type Permission,
} from "../api/rbac";
import { resolveHighestRole } from "../scim/scim-role-resolver";

// ============================================================================
// Types
// ============================================================================

export type ScopeRef =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

export type ResolvedRole = {
  role: TeamUserRole;
  customRoleId: string | null;
  /** true when the result came from the legacy TeamUser fallback */
  fromFallback: boolean;
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
 * Resolves the effective role a user has at a given scope by walking
 * RoleBinding records (direct + via group membership).
 *
 * Resolution rules:
 * 1. Collect all RoleBindings for the user (direct) and all groups the user
 *    belongs to (expanded).
 * 2. Walk scopes from most-specific to least-specific. The first scope that
 *    has at least one binding wins. Multiple bindings at the same winning
 *    scope are resolved to the highest role.
 * 3. ORG-level ADMIN bindings always grant access regardless of scope.
 * 4. If no RoleBinding exists at any scope, falls back to the legacy TeamUser
 *    table. This fallback is removed once migration is complete.
 *
 * Returns null if the user has no access at any scope.
 */
export async function resolveEffectiveRole({
  prisma,
  userId,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  scope: ScopeRef;
}): Promise<ResolvedRole | null> {
  // ── 1. Fetch all RoleBindings for this user in this org (direct + via groups) ──
  const [directBindings, groupBindings] = await Promise.all([
    prisma.roleBinding.findMany({
      where: { organizationId, userId },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    }),
    prisma.roleBinding.findMany({
      where: {
        organizationId,
        group: { members: { some: { userId } } },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    }),
  ]);

  const allBindings = [...directBindings, ...groupBindings];

  // If no RoleBindings exist for this user at all, fall back to TeamUser
  if (allBindings.length === 0) {
    return resolveLegacyFallback({ prisma, userId, organizationId, scope });
  }

  // ── 2. Check org-level ADMIN binding — always grants full access ──
  const orgAdminBinding = allBindings.find(
    (b) =>
      b.scopeType === RoleBindingScopeType.ORGANIZATION &&
      b.scopeId === organizationId &&
      b.role === TeamUserRole.ADMIN,
  );
  if (orgAdminBinding) {
    return {
      role: TeamUserRole.ADMIN,
      customRoleId: orgAdminBinding.customRoleId,
      fromFallback: false,
    };
  }

  // ── 3. Walk scopes most-specific → least-specific ──
  const scopes = ancestorScopes(scope);

  // Also include org scope as last resort (non-admin org bindings)
  if (scope.type !== "org") {
    scopes.push({
      type: RoleBindingScopeType.ORGANIZATION,
      id: organizationId,
    });
  }

  for (const { type, id } of scopes) {
    const matchingBindings = allBindings.filter(
      (b) => b.scopeType === type && b.scopeId === id,
    );

    if (matchingBindings.length === 0) continue;

    // Multiple bindings at same scope → pick highest role
    const roles = matchingBindings.map((b) => b.role);
    const highest = resolveHighestRole(roles);

    // For CUSTOM role, find the associated customRoleId (prefer direct binding)
    const customRoleId =
      highest === TeamUserRole.CUSTOM
        ? (matchingBindings.find(
            (b) => b.role === TeamUserRole.CUSTOM && b.customRoleId,
          )?.customRoleId ?? null)
        : null;

    return { role: highest, customRoleId, fromFallback: false };
  }

  return null;
}

// ============================================================================
// Legacy fallback (TeamUser)
// ============================================================================

/**
 * Fallback to the legacy TeamUser model when no RoleBindings exist.
 * This is removed once the migration is complete.
 *
 * @internal
 */
async function resolveLegacyFallback({
  prisma,
  userId,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  scope: ScopeRef;
}): Promise<ResolvedRole | null> {
  const teamId =
    scope.type === "project"
      ? scope.teamId
      : scope.type === "team"
        ? scope.id
        : null;

  if (!teamId) return null;

  const teamUser = await prisma.teamUser.findFirst({
    where: { userId, teamId },
    select: { role: true, assignedRoleId: true },
  });

  if (!teamUser) return null;

  return {
    role: teamUser.role,
    customRoleId: teamUser.assignedRoleId ?? null,
    fromFallback: true,
  };
}

// ============================================================================
// Permission check helper
// ============================================================================

/**
 * Checks whether a user has a specific permission at a given scope,
 * taking into account the resolved role and any custom role permissions.
 *
 * Returns false if the user has no binding at the requested scope.
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
  const resolved = await resolveEffectiveRole({
    prisma,
    userId,
    organizationId,
    scope,
  });

  if (!resolved) return false;

  // Custom role — look up its permissions
  if (resolved.role === TeamUserRole.CUSTOM && resolved.customRoleId) {
    const customRole = await prisma.customRole.findUnique({
      where: { id: resolved.customRoleId },
      select: { permissions: true },
    });
    const perms = Array.isArray(customRole?.permissions)
      ? (customRole.permissions as string[])
      : [];
    if (perms.length > 0) {
      return hasPermissionWithHierarchy(perms, permission);
    }
    // Empty custom role — fall through to built-in VIEWER
  }

  return teamRoleHasPermission(resolved.role, permission);
}

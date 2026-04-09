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
 * Collects all RoleBindings for a user that are relevant to the given scope
 * (i.e. at any ancestor scope: project → team → org).
 *
 * Falls back to the legacy TeamUser table only when the user has NO RoleBindings
 * in the org at all (migration guard — prevents privilege escalation when a user
 * has bindings for some teams but not the one being checked).
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
}): Promise<Array<{ role: TeamUserRole; customRoleId: string | null; fromFallback: boolean }>> {
  // Fetch ALL bindings for the user in this org (no scope filter) so we can
  // decide whether to fall back to TeamUser.
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

  // If the user has NO bindings in this org at all, fall back to TeamUser
  if (allOrgBindings.length === 0) {
    const fallback = await resolveLegacyFallback({ prisma, userId, organizationId, scope });
    return fallback ? [{ ...fallback }] : [];
  }

  // Filter to bindings at ancestor scopes of the requested scope
  const ancestorScopeList = ancestorScopes(scope);
  if (scope.type !== "org") {
    ancestorScopeList.push({ type: RoleBindingScopeType.ORGANIZATION, id: organizationId });
  }

  const matching = allOrgBindings.filter((b) =>
    ancestorScopeList.some((s) => s.type === b.scopeType && s.id === b.scopeId),
  );

  return matching.map((b) => ({ role: b.role, customRoleId: b.customRoleId, fromFallback: false }));
}

/**
 * @deprecated Prefer checkRoleBindingPermission — there is no single
 * "effective role" when a user holds multiple bindings. This function
 * returns the highest built-in role across all matching bindings as a
 * best-effort approximation (used by migration tooling only).
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
  const bindings = await collectBindingsForScope({ prisma, userId, organizationId, scope });
  if (bindings.length === 0) return null;

  const fromFallback = bindings.some((b) => b.fromFallback);
  const highest = resolveHighestRole(bindings.map((b) => b.role));
  const customRoleId =
    highest === TeamUserRole.CUSTOM
      ? (bindings.find((b) => b.role === TeamUserRole.CUSTOM && b.customRoleId)?.customRoleId ?? null)
      : null;

  return { role: highest, customRoleId, fromFallback };
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

    if (teamRoleHasPermission(binding.role, permission)) {
      return true;
    }
  }

  return false;
}

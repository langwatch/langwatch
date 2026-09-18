import type { AuthzScopeRef, CollectedBinding, CollectedGrants, ResourceGrant } from "./authz.ts";
/**
 * Grant rules: does a binding/legacy row/resource grant carry the requested
 * permission? Walk decides which to consult and order (ADR-092 §2).
 */
import { bindingScopeCanGrantPermission, permissionSatisfiedBy } from "./registry.ts";
import { builtinRoleGrants, roleKeyForTeamRole } from "./roles.ts";
import { audienceMatches, type ScopeChainLink } from "./scope.ts";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat ordered
// sequence of legacy grant rules whose ORDER is the stage-A parity contract;
// splitting would scatter the one place the rules read top to bottom.
export function bindingGrants({
  binding,
  grants,
  permission,
}: {
  binding: Pick<CollectedBinding, "role" | "customRoleId" | "scopeType">;
  grants: CollectedGrants;
  permission: string;
}): boolean {
  // ADR-021 fence: a team/project binding never grants an org-exclusive
  // permission, even through a custom role that lists it.
  if (
    !bindingScopeCanGrantPermission({
      scopeType: binding.scopeType,
      permission,
    })
  ) {
    return false;
  }

  // Org-scoped non-CUSTOM bindings have their own semantics: ADMIN grants
  // everything, anything else grants the org-member bag only.
  // LEGACY-QUIRK(C): role meaning depends on binding scope until roleKey.
  if (binding.scopeType === "ORGANIZATION" && binding.role !== "CUSTOM") {
    // LEGACY-QUIRK(C): EXTERNAL users are never promoted through org-scoped
    // bindings — OrganizationUser.role is authoritative for the restriction.
    if (grants.organizationRole === "EXTERNAL") return false;
    if (binding.role === "ADMIN") return true;
    return builtinRoleGrants({ role: "org-member", permission });
  }

  // Non-empty custom role is authoritative; empty/missing falls through.
  if (binding.customRoleId) {
    const customPermissions = grants.customRolePermissions.get(binding.customRoleId);
    if (customPermissions && customPermissions.length > 0) {
      return permissionSatisfiedBy({
        granted: new Set(customPermissions),
        requested: permission,
      });
    }
  }

  // LEGACY-QUIRK(C): EXTERNAL caps team/project bindings at the lite-member
  // bag unless a non-empty custom role overrode it above.
  if (grants.organizationRole === "EXTERNAL") {
    return builtinRoleGrants({ role: "lite-member", permission });
  }

  return builtinRoleGrants({
    role: roleKeyForTeamRole(binding.role),
    permission,
  });
}

/**
 * LEGACY-QUIRK(B) — the TeamUser fallback step. Project/team checks consult
 * the team only with ZERO bindings (rbac.ts:765); org checks union every
 * non-personal membership on ANY denial (rbac.ts:1094-1110), both TEAM-scoped.
 */
export function legacyTeamFallbackGrants({
  grants,
  scope,
  chain,
  chainBindingCount,
  permission,
}: {
  grants: CollectedGrants;
  scope: AuthzScopeRef;
  chain: readonly ScopeChainLink[];
  chainBindingCount: number;
  permission: string;
}): boolean {
  if (scope.type !== "organization" && chainBindingCount > 0) return false;
  const candidateTeams =
    scope.type === "organization"
      ? grants.legacyTeamMemberships.filter((row) => !row.isPersonal)
      : grants.legacyTeamMemberships.filter((row) =>
          chain.some((link) => link.scopeType === "TEAM" && link.scopeId === row.teamId),
        );
  return candidateTeams.some((row) =>
    bindingGrants({
      binding: {
        role: row.role,
        customRoleId: row.customRoleId,
        scopeType: "TEAM",
      },
      grants,
      permission,
    }),
  );
}

/**
 * Resource grants with least-redacting audience win; only path for anonymous
 * principals (ADR-092 §8). Deterministic: not dependent on database row order.
 */
export function findResourceGrant({
  scope,
  resourceGrants,
  grants,
  permission,
}: {
  scope: Extract<AuthzScopeRef, { type: "resource" }>;
  resourceGrants: readonly ResourceGrant[];
  grants: CollectedGrants;
  permission: string;
}): ResourceGrant | undefined {
  const links = [{ kind: scope.kind, id: scope.id }, ...(scope.parents ?? [])];
  const matched = resourceGrants.filter(
    (grant) =>
      grant.projectId === scope.projectId &&
      links.some((link) => link.kind === grant.kind && link.id === grant.id) &&
      permissionSatisfiedBy({
        granted: new Set([grant.permission]),
        requested: permission,
      }) &&
      audienceMatches({ audience: grant.audience, grants }),
  );
  return matched.find((grant) => grant.audience.kind !== "anyone") ?? matched[0];
}

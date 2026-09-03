/**
 * ADR-092 §2 — the grant rules themselves: given one binding (or one legacy
 * row, or one resource grant), does it carry the permission being asked for?
 * The walk in walk.ts decides WHICH of these to consult and in what order;
 * this module is the one copy of what each of them MEANS.
 *
 * Deliberate legacy quirks are tagged `LEGACY-QUIRK(<stage>)` with the
 * migration stage that removes them — the shadow comparison depends on this
 * file matching legacy behaviour, warts and all.
 */
import { bindingScopeCanGrantPermission, permissionSatisfiedBy } from "./registry";
import { builtinRoleGrants, roleKeyForTeamRole } from "./roles";
import { audienceMatches, type ScopeChainLink } from "./scope";
import type {
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  ResourceGrant,
} from "./authz";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat, ordered sequence of legacy grant rules (fence → org-scoped semantics → custom role → EXTERNAL cap → built-in bag) whose ORDER is the stage-A parity contract; the score counts the guards, and splitting them would scatter the one place the rules read top to bottom.
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
 * LEGACY-QUIRK(B) — the TeamUser fallback step of the walk. Project/team
 * checks consult the chain's team only when the principal has ZERO bindings
 * on the chain (rbac.ts:765); organization checks union every non-personal
 * membership on ANY denial, even when org-scoped bindings exist
 * (rbac.ts:1094-1110). Both respect the ADR-021 fence via TEAM-scoped
 * evaluation.
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
 * ADR-092 §8 — the resource-tier step of the walk: a grant sitting on the
 * resource itself or a shareable ancestor (a trace inside a shared thread)
 * that carries the permission and includes this caller, matched on
 * (kind, id, projectId) plus audience. The ONLY path an anonymous
 * principal can take.
 *
 * When several grants match, the least-redacting audience wins: any
 * membership audience beats `anyone`, so a signed-in member who follows a
 * public link still gets the member view. Picking the first row instead
 * would make `decision.audience` depend on database row order.
 */
export function matchResourceGrant({
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

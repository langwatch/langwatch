/**
 * ADR-092 §2 — where a question is asked, and who a resource grant reaches.
 * Pure geometry over a scope reference: the binding scopes that can answer at
 * it, the organization it belongs to, and whether an audience covers the
 * caller. No walk logic lives here.
 */
import type { AuthzScopeRef, CollectedGrants, GrantAudience, RoleBindingScopeType } from "./authz";

/** One link of a scope chain: a binding scope that can grant at the scope. */
export type ScopeChainLink = {
  scopeType: RoleBindingScopeType;
  scopeId: string;
};

/** The organization a scope belongs to, whatever its tier. */
export function scopeOrganizationId(scope: AuthzScopeRef): string {
  return scope.type === "organization" ? scope.id : scope.organizationId;
}

/** The binding scopes that can grant at `scope`, most specific first. */
export function scopeChain(scope: AuthzScopeRef): ScopeChainLink[] {
  switch (scope.type) {
    case "project":
      return [
        { scopeType: "PROJECT", scopeId: scope.id },
        { scopeType: "TEAM", scopeId: scope.teamId },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
    case "team":
      return [
        { scopeType: "TEAM", scopeId: scope.id },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
    case "organization":
      return [{ scopeType: "ORGANIZATION", scopeId: scope.id }];
    case "resource":
      // Bindings can grant at any ancestor of the resource's project; the
      // resource links themselves are matched against ResourceGrants, not
      // RoleBindings (see the resource-grant step in walk.ts).
      return [
        { scopeType: "PROJECT", scopeId: scope.projectId },
        { scopeType: "TEAM", scopeId: scope.teamId },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
  }
}

/**
 * ADR-092 §8 — does a resource grant's audience include this caller? The
 * membership audiences are matched against the caller's collected grants
 * rather than enumerated members. Two v1 proxies, both documented for the
 * C5 storage pass to replace with direct membership probes: group audiences
 * are visible only through group-derived bindings, and team/project
 * audiences through a binding (or legacy row) at that scope.
 */
export function audienceMatches({
  audience,
  grants,
}: {
  audience: GrantAudience;
  grants: CollectedGrants;
}): boolean {
  switch (audience.kind) {
    case "anyone":
      return true;
    case "user":
      return grants.principal.type === "user" && grants.principal.id === audience.id;
    case "apiKey":
      return grants.principal.type === "apiKey" && grants.principal.id === audience.id;
    case "group":
      return grants.bindings.some((binding) => binding.viaGroupId === audience.id);
    case "organization":
      return grants.isOrgMember && grants.organizationId === audience.id;
    case "team":
      return (
        grants.bindings.some(
          (binding) => binding.scopeType === "TEAM" && binding.scopeId === audience.id,
        ) || grants.legacyTeamMemberships.some((row) => row.teamId === audience.id)
      );
    case "project":
      return grants.bindings.some(
        (binding) => binding.scopeType === "PROJECT" && binding.scopeId === audience.id,
      );
  }
}

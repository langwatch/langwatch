/**
 * ADR-092 §2 — where a question is asked, and who a resource grant reaches.
 * Pure geometry over a scope reference: the binding scopes that can answer
 * at it, its organization, and whether an audience covers the caller.
 */
import {
  AUTHZ_RESOURCES,
  type AuthzResource,
  type AuthzScopeType,
  permissionResource,
} from "@langwatch/authorization";

import type { AuthzScopeRef, CollectedGrants, GrantAudience, GrantScopeTier } from "./authz.ts";

/** One link of a scope chain: a binding scope that can grant at the scope. */
export type ScopeChainLink = {
  scopeType: GrantScopeTier;
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
 * ADR-092 §8 — does a resource grant's audience include this caller?
 * Matched against collected grants, not enumerated members: group via
 * group-derived bindings, team/project via a binding at scope (v1 proxies, C5).
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
      return grants.bindings.some(
        (binding) => binding.scopeType === "TEAM" && binding.scopeId === audience.id,
      );
    case "project":
      return grants.bindings.some(
        (binding) => binding.scopeType === "PROJECT" && binding.scopeId === audience.id,
      );
  }
}

/**
 * ADR-021 scope fence as registry data: a binding at `scopeType` may grant
 * `permission` only when the permission's resource is grantable at or
 * below that tier. Platform resources are never grantable by any binding.
 */
export function bindingScopeCanGrantPermission({
  scopeType,
  permission,
}: {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  permission: string;
}): boolean {
  const resource = permissionResource(permission);
  const def = AUTHZ_RESOURCES[resource as AuthzResource];
  // Unknown resources (legacy custom-role strings outside the registry) are
  // treated as non-exclusive, matching the legacy fence which only checks a
  // fixed org-exclusive set.
  if (!def) return true;
  const scopes: readonly AuthzScopeType[] = def.scopes;
  // LEGACY-QUIRK(C): the legacy fence only knows the org-exclusive set, so a
  // custom role CAN today grant `ops:*` from any binding. The platform tier
  // becomes a real fence in stage C when platform-ops turns into a principal.
  if (scopes.includes("platform")) return true;
  if (scopeType === "ORGANIZATION") return true;
  return scopes.includes("team") || scopes.includes("project");
}

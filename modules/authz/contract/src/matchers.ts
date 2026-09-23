import type { AuthzScopeRef, CollectedBinding, CollectedGrants, ResourceGrant } from "./authz.ts";
/**
 * Grant rules: does a binding/legacy row/resource grant carry the requested
 * permission? Walk decides which to consult and order (ADR-092 §2).
 */
import { bindingScopeCanGrantPermission, permissionSatisfiedBy } from "./registry.ts";
import { builtinRoleGrants } from "./roles.ts";
import { audienceMatches } from "./scope.ts";

export function bindingGrants({
  binding,
  grants,
  permission,
}: {
  binding: Pick<CollectedBinding, "roleKey" | "scopeType">;
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

  const { roleKey } = binding;
  // A custom key is authoritative, including grants imported beside a legacy
  // built-in role. Missing or empty role facts never restore that old role.
  if (roleKey.startsWith("custom:")) {
    const customRoleId = roleKey.slice("custom:".length);
    if (customRoleId.length === 0) return false;
    const customPermissions = grants.customRolePermissions.get(customRoleId);
    if (!customPermissions || customPermissions.length === 0) return false;
    return permissionSatisfiedBy({
      granted: new Set(customPermissions),
      requested: permission,
    });
  }

  if (roleKey !== "admin" && roleKey !== "member" && roleKey !== "viewer") {
    return false;
  }

  // Organization grants retain their existing scope-specific meaning:
  // admin covers everything; member and viewer carry the organization floor.
  if (binding.scopeType === "ORGANIZATION") {
    if (grants.organizationRole === "EXTERNAL") return false;
    if (roleKey === "admin") return true;
    return builtinRoleGrants({ role: "org-member", permission });
  }

  // EXTERNAL membership caps built-in team/project grants, not custom roles.
  if (grants.organizationRole === "EXTERNAL") {
    return builtinRoleGrants({ role: "lite-member", permission });
  }

  return builtinRoleGrants({ role: roleKey, permission });
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

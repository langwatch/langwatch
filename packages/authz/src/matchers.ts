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
import {
  bindingScopeCanGrantPermission,
  permissionSatisfiedBy,
} from "./registry";
import { builtinRoleGrants } from "./roles";
import { audienceMatches } from "./scope";
import type {
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  ResourceGrant,
} from "./types";

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
  return (
    matched.find((grant) => grant.audience.kind !== "anyone") ?? matched[0]
  );
}

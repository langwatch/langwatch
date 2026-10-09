/**
 * Grant rules: does a binding/legacy row/resource grant carry the requested
 * permission? Walk decides which to consult and order (ADR-092 §2).
 */
import { permissionSatisfiedBy } from "@langwatch/authorization";

import type { AuthzScopeRef, CollectedBinding, CollectedGrants, ResourceGrant } from "./authz.ts";
import { builtinRoleGrants, PROJECT_READER_ROLE_KEY } from "./roles.ts";
import { audienceMatches, bindingScopeCanGrantPermission } from "./scope.ts";

/**
 * ADR-171: a Developer holds its personal team and nothing shared. An
 * ORGANIZATION-scoped binding reaches every project and a group binding
 * whatever the group maps to, so neither grants a Developer anything.
 */
function developerSeatExcludes({
  binding,
  grants,
}: {
  binding: Pick<CollectedBinding, "scopeType" | "viaGroupId">;
  grants: CollectedGrants;
}): boolean {
  if (grants.organizationRole !== "DEVELOPER") return false;
  return binding.scopeType === "ORGANIZATION" || Boolean(binding.viaGroupId);
}

/**
 * A Lite seat holds at most a Lite Member's permissions however the grant arrives (a direct
 * custom role too), and nothing organization-wide through a group. Read at every collect, so
 * the cap lifts once the person holds a full seat (seat-limit-at-provisioning.feature).
 */
function liteSeatWithholds({
  binding,
  grants,
  permission,
}: {
  binding: Pick<CollectedBinding, "scopeType" | "viaGroupId">;
  grants: Pick<CollectedGrants, "organizationRole">;
  permission: string;
}): boolean {
  if (grants.organizationRole !== "EXTERNAL") return false;
  if (binding.viaGroupId && binding.scopeType === "ORGANIZATION") return true;
  return !builtinRoleGrants({ role: "lite-member", permission });
}

/** Whether the seat holds this binding below the permissions it lists: shown as capped. */
export function seatCapsBinding({
  binding,
  organizationRole,
  permissions,
}: {
  binding: Pick<CollectedBinding, "scopeType" | "viaGroupId">;
  organizationRole: CollectedGrants["organizationRole"];
  permissions: readonly string[];
}): boolean {
  return permissions.some((permission) =>
    liteSeatWithholds({ binding, grants: { organizationRole }, permission }),
  );
}

/** A custom role grants exactly its own permissions; an unknown or empty one grants nothing. */
function customRoleGrants({
  roleKey,
  grants,
  permission,
}: {
  roleKey: string;
  grants: CollectedGrants;
  permission: string;
}): boolean {
  const customRoleId = roleKey.slice("custom:".length);
  if (customRoleId.length === 0) return false;
  const customPermissions = grants.customRolePermissions.get(customRoleId);
  if (!customPermissions || customPermissions.length === 0) return false;
  return permissionSatisfiedBy({ granted: new Set(customPermissions), requested: permission });
}

export function bindingGrants({
  binding,
  grants,
  permission,
}: {
  binding: Pick<CollectedBinding, "roleKey" | "scopeType" | "viaGroupId">;
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

  if (developerSeatExcludes({ binding, grants })) return false;
  if (liteSeatWithholds({ binding, grants, permission })) return false;

  const { roleKey } = binding;
  // A custom key is authoritative, including grants imported beside a legacy
  // built-in role. Missing or empty role facts never restore that old role.
  if (roleKey.startsWith("custom:")) return customRoleGrants({ roleKey, grants, permission });

  // ADR-177: a shared project-to-project read, placed on a PROJECT scope only.
  // No organisation role or EXTERNAL cap widens or narrows it: the principal
  // is a project, which has neither.
  if (roleKey === PROJECT_READER_ROLE_KEY) {
    return (
      binding.scopeType === "PROJECT" &&
      builtinRoleGrants({ role: PROJECT_READER_ROLE_KEY, permission })
    );
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

  // EXTERNAL membership holds a built-in team/project grant as the lite-member bag.
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

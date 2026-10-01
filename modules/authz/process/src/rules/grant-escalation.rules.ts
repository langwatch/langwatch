/**
 * Nobody grants more than they hold: the one decision every door (REST old and
 * new, tRPC, custom-role edits) reaches through the binding writer or
 * `AuthzApi.findPermissionsBeyondCaller`. specs/rbac/grants-rest-api.feature.
 */
import { ALL_PERMISSIONS, permissionSatisfiedBy } from "@langwatch/authorization";
import {
  builtinRolePermissions,
  roleKeyForTeamRole,
  type AuthzManagedOrganizationBinding,
  type GrantScopeTier,
  type TeamUserRole,
} from "@langwatch/authz-contract";

/** What a binding confers, read the way the engine's matcher reads it. */
export function permissionsConferred({
  role,
  scopeType,
  customPermissions,
}: {
  role: TeamUserRole;
  scopeType: GrantScopeTier;
  customPermissions: readonly string[];
}): readonly string[] {
  if (role === "CUSTOM") return customPermissions;
  if (scopeType === "ORGANIZATION") {
    return role === "ADMIN" ? ALL_PERMISSIONS : [...builtinRolePermissions("org-member")];
  }

  return [...builtinRolePermissions(roleKeyForTeamRole(role))];
}

/** The requested permissions the held set does not satisfy, `manage` implying its actions. */
export function findPermissionsBeyondHeld({
  requested,
  held,
}: {
  requested: readonly string[];
  held: readonly string[];
}): string[] {
  const granted = new Set(held);

  return [...new Set(requested)].filter(
    (permission) => !permissionSatisfiedBy({ granted, requested: permission }),
  );
}

/** Ruled by Alex (2026-09-30): an organization-wide cap on total grants, no per-identical cap. */
export const GRANT_LIMIT_PER_ORGANIZATION = 10_000;

export function isGrantLimitReached({ existing }: { existing: number }): boolean {
  return existing >= GRANT_LIMIT_PER_ORGANIZATION;
}

type AdminCandidate = Pick<
  AuthzManagedOrganizationBinding,
  "id" | "role" | "scopeType" | "userId" | "memberUserIds" | "expiresAt"
>;

/** A live organization admin grant a person signs in with: a user's or a non-empty group's. */
function isLiveOrganizationAdmin({ row, nowMs }: { row: AdminCandidate; nowMs: number }): boolean {
  const live = !row.expiresAt || row.expiresAt.getTime() > nowMs;
  const person = row.userId !== null || row.memberUserIds.length > 0;

  return live && person && row.scopeType === "ORGANIZATION" && row.role === "ADMIN";
}

/** Whether taking this grant away leaves the organization with no live administrator. */
export function isLastOrganizationAdmin({
  rows,
  grantId,
  nowMs,
}: {
  rows: readonly AdminCandidate[];
  grantId: string;
  nowMs: number;
}): boolean {
  const admins = rows.filter((row) => isLiveOrganizationAdmin({ row, nowMs }));

  return admins.length > 0 && admins.every((row) => row.id === grantId);
}

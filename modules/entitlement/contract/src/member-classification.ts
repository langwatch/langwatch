/**
 * Full vs. lite membership, and what a role change does to it. Pure over a
 * role and its resolved permissions, so a peer answering its own seat
 * questions needs no capability from this module, only these functions.
 */
import { OrganizationUserRole } from "@langwatch/authorization";

/** Full and Lite are metered by the plan; a Developer (ADR-171) is counted and never capped. */
export type MemberType = "FullMember" | "LiteMember" | "Developer";
/** Named after the pool the change ENTERS; "to-developer" enters one no plan meters. */
export type RoleChangeType = "no-change" | "lite-to-full" | "full-to-lite" | "to-developer";

export function isViewOnlyPermission(permission: string): boolean {
  return permission.split(":")[1] === "view";
}

export function isViewOnlyCustomRole(permissions: string[]): boolean {
  return permissions.every(isViewOnlyPermission);
}

export function classifyMemberType(
  role: OrganizationUserRole,
  permissions: string[] | undefined,
): MemberType {
  if (role === OrganizationUserRole.ADMIN || role === OrganizationUserRole.MEMBER)
    return "FullMember";
  if (role === OrganizationUserRole.DEVELOPER) return "Developer";
  if (role === OrganizationUserRole.EXTERNAL && permissions && !isViewOnlyCustomRole(permissions))
    return "FullMember";
  return "LiteMember";
}

export function isFullMember(
  role: OrganizationUserRole,
  permissions: string[] | undefined,
): boolean {
  return classifyMemberType(role, permissions) === "FullMember";
}

export function isLiteMember(
  role: OrganizationUserRole,
  permissions: string[] | undefined,
): boolean {
  return classifyMemberType(role, permissions) === "LiteMember";
}

/** A Developer seat (ADR-171); permissions never move it. */
export function isDeveloper(
  role: OrganizationUserRole,
  permissions: string[] | undefined,
): boolean {
  return classifyMemberType(role, permissions) === "Developer";
}

export function getRoleChangeType({
  oldRole,
  oldPermissions,
  newRole,
  newPermissions,
}: {
  oldRole: OrganizationUserRole;
  oldPermissions: string[] | undefined;
  newRole: OrganizationUserRole;
  newPermissions: string[] | undefined;
}): RoleChangeType {
  const was = classifyMemberType(oldRole, oldPermissions);
  const willBe = classifyMemberType(newRole, newPermissions);
  if (was === willBe) return "no-change";
  if (willBe === "Developer") return "to-developer";
  return willBe === "FullMember" ? "lite-to-full" : "full-to-lite";
}

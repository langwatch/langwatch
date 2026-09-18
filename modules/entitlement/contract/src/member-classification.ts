/**
 * Full vs. lite membership, and what a role change does to it. Pure over a
 * role and its resolved permissions, so a peer answering its own seat
 * questions needs no capability from this module, only these functions.
 */
import { OrganizationUserRole } from "@langwatch/authz-contract";

export type MemberType = "FullMember" | "LiteMember";
export type RoleChangeType = "no-change" | "lite-to-full" | "full-to-lite";

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

export function getRoleChangeType(
  oldRole: OrganizationUserRole,
  oldPermissions: string[] | undefined,
  newRole: OrganizationUserRole,
  newPermissions: string[] | undefined,
): RoleChangeType {
  const wasFull = isFullMember(oldRole, oldPermissions);
  const willBeFull = isFullMember(newRole, newPermissions);
  if (wasFull === willBeFull) return "no-change";
  return wasFull ? "full-to-lite" : "lite-to-full";
}

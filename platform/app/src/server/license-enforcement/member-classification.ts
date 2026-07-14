import { OrganizationUserRole } from "@prisma/client";

export type MemberType = "FullMember" | "LiteMember";

/**
 * Checks if a permission string represents a view-only action.
 * Permissions follow the format "resource:action" (e.g., "project:view").
 *
 * @param permission - Permission string in "resource:action" format
 * @returns true if the action is "view", false otherwise
 */
export function isViewOnlyPermission(permission: string): boolean {
  const action = permission.split(":")[1];
  return action === "view";
}

/**
 * Checks if all permissions in a custom role are view-only.
 * A view-only custom role can only view resources but cannot manage, create, update, delete, or share.
 *
 * @param permissions - Array of permission strings
 * @returns true if ALL permissions are view-only (or if empty), false if any permission allows modifications
 */
export function isViewOnlyCustomRole(permissions: string[]): boolean {
  return permissions.every(isViewOnlyPermission);
}

/**
 * Classifies a member as FullMember or LiteMember based on role and permissions.
 *
 * Classification rules:
 * - ADMIN or MEMBER roles are always FullMember
 * - EXTERNAL role with non-view permissions is FullMember (elevated to full access)
 * - EXTERNAL role with no permissions or view-only permissions is Lite Member
 *
 * Note: The EXTERNAL enum value corresponds to "Lite Member" in user-facing terminology.
 *
 * @param role - Organization user role (ADMIN, MEMBER, or EXTERNAL)
 * @param permissions - Optional array of permission strings from custom role
 * @returns MemberType classification
 */
export function classifyMemberType(
  role: OrganizationUserRole,
  permissions: string[] | undefined
): MemberType {
  // ADMIN or MEMBER roles are always FullMember
  if (
    role === OrganizationUserRole.ADMIN ||
    role === OrganizationUserRole.MEMBER
  ) {
    return "FullMember";
  }

  // EXTERNAL role with non-view custom permissions is elevated to FullMember
  if (
    role === OrganizationUserRole.EXTERNAL &&
    permissions &&
    !isViewOnlyCustomRole(permissions)
  ) {
    return "FullMember";
  }

  // EXTERNAL role with no permissions or view-only permissions is Lite Member
  return "LiteMember";
}

/**
 * Checks if a member is a Full Member based on role and permissions.
 *
 * @param role - Organization user role
 * @param permissions - Optional array of permission strings from custom role
 * @returns true if the member is a Full Member
 */
export function isFullMember(
  role: OrganizationUserRole,
  permissions: string[] | undefined
): boolean {
  return classifyMemberType(role, permissions) === "FullMember";
}

/**
 * Checks if a member is a Lite Member based on role and permissions.
 *
 * Lite Member users have the EXTERNAL role with view-only or no custom permissions.
 *
 * @param role - Organization user role
 * @param permissions - Optional array of permission strings from custom role
 * @returns true if the member is a Lite Member
 */
export function isLiteMember(
  role: OrganizationUserRole,
  permissions: string[] | undefined
): boolean {
  return classifyMemberType(role, permissions) === "LiteMember";
}

export type RoleChangeType =
  | "no-change" // Same member type
  | "lite-to-full" // Lite Member → Full Member
  | "full-to-lite"; // Full Member → Lite Member

/**
 * Determines if a role change would change the member type.
 * Used for license limit validation when updating member roles.
 *
 * @param oldRole - Current organization user role
 * @param oldPermissions - Current custom role permissions (if any)
 * @param newRole - New organization user role
 * @param newPermissions - New custom role permissions (if any)
 * @returns RoleChangeType indicating if/how the member type would change
 */
export function getRoleChangeType(
  oldRole: OrganizationUserRole,
  oldPermissions: string[] | undefined,
  newRole: OrganizationUserRole,
  newPermissions: string[] | undefined
): RoleChangeType {
  const wasFull = isFullMember(oldRole, oldPermissions);
  const willBeFull = isFullMember(newRole, newPermissions);

  if (wasFull === willBeFull) return "no-change";
  return wasFull ? "full-to-lite" : "lite-to-full";
}

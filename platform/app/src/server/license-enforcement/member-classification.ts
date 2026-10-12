import { OrganizationUserRole } from "~/generated/prisma/client";

/**
 * The three kinds of seat. Full and Lite are metered by the plan; Developer
 * (ADR-143) is counted so the plan page can show it and never capped.
 */
export type MemberType = "FullMember" | "LiteMember" | "Developer";

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
 * - DEVELOPER is always Developer; permissions never move it, because a
 *   Developer holds no custom role anywhere (ADR-143)
 * - EXTERNAL role with non-view permissions is FullMember (elevated to full access)
 * - EXTERNAL role with no permissions or view-only permissions is Lite Member
 *
 * Note: The EXTERNAL enum value corresponds to "Lite Member" in user-facing terminology.
 *
 * @param role - Organization user role (ADMIN, MEMBER, EXTERNAL or DEVELOPER)
 * @param permissions - Optional array of permission strings from custom role
 * @returns MemberType classification
 */
export function classifyMemberType(
  role: OrganizationUserRole,
  permissions: string[] | undefined,
): MemberType {
  // ADMIN or MEMBER roles are always FullMember
  if (
    role === OrganizationUserRole.ADMIN ||
    role === OrganizationUserRole.MEMBER
  ) {
    return "FullMember";
  }

  if (role === OrganizationUserRole.DEVELOPER) {
    return "Developer";
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
  permissions: string[] | undefined,
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
  permissions: string[] | undefined,
): boolean {
  return classifyMemberType(role, permissions) === "LiteMember";
}

/**
 * Whether a member holds a Developer seat (ADR-143). Permissions are
 * accepted for symmetry with the other predicates and never change the answer.
 */
export function isDeveloper(
  role: OrganizationUserRole,
  permissions: string[] | undefined,
): boolean {
  return classifyMemberType(role, permissions) === "Developer";
}

/**
 * Named after the seat pool the change ENTERS, because that is the pool the
 * licence guard has to check: "lite-to-full" enters the Full pool,
 * "full-to-lite" enters the Lite pool, and "to-developer" enters a pool the
 * plan does not meter, so the guard has nothing to check.
 */
export type RoleChangeType =
  | "no-change" // Same member type
  | "lite-to-full" // Enters the Full Member pool
  | "full-to-lite" // Enters the Lite Member pool
  | "to-developer"; // Enters the Developer pool, never capped

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
  newPermissions: string[] | undefined,
): RoleChangeType {
  const was = classifyMemberType(oldRole, oldPermissions);
  const willBe = classifyMemberType(newRole, newPermissions);

  if (was === willBe) return "no-change";
  if (willBe === "Developer") return "to-developer";
  return willBe === "FullMember" ? "lite-to-full" : "full-to-lite";
}

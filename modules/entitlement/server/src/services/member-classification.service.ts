/**
 * Whether a seat is a full member or a lite one.
 */
import { OrganizationUserRole } from "@langwatch/authz-contract";

/**
 * What a seat counts as against the plan's two member allowances.
 */
export type MemberType = "FullMember" | "LiteMember";

export type RoleChangeType =
  | "no-change" // Same member type
  | "lite-to-full" // Lite Member → Full Member
  | "full-to-lite"; // Full Member → Lite Member

export class MemberClassificationService {
  static create(): MemberClassificationService {
    return new MemberClassificationService();
  }

  /**
   * Checks if a permission string represents a view-only action.
   * Permissions follow the format "resource:action" (e.g., "project:view").
   */
  static isViewOnlyPermission(permission: string): boolean {
    const action = permission.split(":")[1];

    return action === "view";
  }

  /**
   * Checks if all permissions in a custom role are view-only.
   * A view-only custom role can only view resources but cannot manage, create,
   * update, delete, or share.
   */
  static isViewOnlyCustomRole(permissions: string[]): boolean {
    return permissions.every((permission) =>
      MemberClassificationService.isViewOnlyPermission(permission),
    );
  }

  /**
   * Classifies a member as FullMember or LiteMember based on role and permissions.
   */
  static classifyMemberType(
    role: OrganizationUserRole,
    permissions: string[] | undefined,
  ): MemberType {
    // ADMIN or MEMBER roles are always FullMember
    if (role === OrganizationUserRole.ADMIN || role === OrganizationUserRole.MEMBER) {
      return "FullMember";
    }

    // EXTERNAL role with non-view custom permissions is elevated to FullMember
    if (
      role === OrganizationUserRole.EXTERNAL &&
      permissions &&
      !MemberClassificationService.isViewOnlyCustomRole(permissions)
    ) {
      return "FullMember";
    }

    // EXTERNAL role with no permissions or view-only permissions is Lite Member
    return "LiteMember";
  }

  /** Checks if a member is a Full Member based on role and permissions. */
  static isFullMember(role: OrganizationUserRole, permissions: string[] | undefined): boolean {
    return MemberClassificationService.classifyMemberType(role, permissions) === "FullMember";
  }

  /**
   * Checks if a member is a Lite Member based on role and permissions.
   *
   * Lite Member users have the EXTERNAL role with view-only or no custom permissions.
   */
  static isLiteMember(role: OrganizationUserRole, permissions: string[] | undefined): boolean {
    return MemberClassificationService.classifyMemberType(role, permissions) === "LiteMember";
  }

  /**
   * Determines if a role change would change the member type.
   * Used for license limit validation when updating member roles.
   */
  static getRoleChangeType(
    oldRole: OrganizationUserRole,
    oldPermissions: string[] | undefined,
    newRole: OrganizationUserRole,
    newPermissions: string[] | undefined,
  ): RoleChangeType {
    const wasFull = MemberClassificationService.isFullMember(oldRole, oldPermissions);
    const willBeFull = MemberClassificationService.isFullMember(newRole, newPermissions);

    if (wasFull === willBeFull) {
      return "no-change";
    }

    return wasFull ? "full-to-lite" : "lite-to-full";
  }
}

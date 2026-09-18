// Built-in roles from contract; parity-tested against engine; unit test catches omissions.

import {
  type AuthzPermission,
  builtinRolePermissions,
  roleKeyForTeamRole,
  type TeamUserRole,
} from "@langwatch/authz-contract";

/** One built-in role, as the page presents it. */
export type BuiltinRoleCard = {
  /** The legacy team role, which is what the permission lookup is keyed on. */
  teamRole: Extract<TeamUserRole, "ADMIN" | "MEMBER" | "VIEWER">;
  name: string;
  description: string;
  /** The badge under the name — a phrase rather than a number, by design. */
  permissionCount: string;
};

/**
 * The three cards, in the order the page lists them. The description is
 * stated ONCE - the platform page carried it twice (card and
 * `getDefaultRoleDescription`), so the two could disagree.
 */
export const BUILTIN_ROLE_CARDS: readonly BuiltinRoleCard[] = [
  {
    teamRole: "ADMIN",
    name: "Admin",
    description: "Full access to all features and settings",
    permissionCount: "All Permissions",
  },
  {
    teamRole: "MEMBER",
    name: "Member",
    description: "Can create and modify most resources, view costs and debug info",
    permissionCount: "Most Permissions",
  },
  {
    teamRole: "VIEWER",
    name: "Viewer",
    description: "Read-only access to analytics, messages, and guardrails",
    permissionCount: "View Only",
  },
];

/** Every permission a built-in role holds, as the viewer reads membership. */
export function builtinRoleGrantedPermissions(
  teamRole: BuiltinRoleCard["teamRole"],
): AuthzPermission[] {
  return [...builtinRolePermissions(roleKeyForTeamRole(teamRole))] as AuthzPermission[];
}

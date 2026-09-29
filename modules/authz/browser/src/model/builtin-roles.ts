// Built-in roles from contract; parity-tested against engine; unit test catches omissions.

import {
  type AuthzPermission,
  builtinRolePermissions,
  roleKeyForTeamRole,
  type TeamUserRole,
} from "@langwatch/authz-contract";

import type { RoleBinding } from "./role-binding-principals.ts";

/** One built-in role, as the page presents it. */
export type BuiltinRoleCard = {
  /** The legacy team role, which is what the permission lookup is keyed on. */
  teamRole: Extract<TeamUserRole, "ADMIN" | "MEMBER" | "VIEWER">;
  name: string;
  description: string;
  /** The tier this one builds on, which the card names instead of repeating its grants. */
  inheritsFrom: string | null;
  /** The few permissions the card shows as chips; the dialog lists the rest. */
  headline: readonly string[];
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
    description:
      "Everything Member can do, and the team as well: who is on it, the projects it owns, and how the gateway routes and spends.",
    inheritsFrom: "Member",
    headline: ["team:manage", "project:delete", "gatewayProviders:manage"],
  },
  {
    teamRole: "MEMBER",
    name: "Member",
    description:
      "Create and change the work itself: traces, datasets, prompts, evaluations, experiments and the keys that call models.",
    inheritsFrom: "Viewer",
    headline: ["datasets:manage", "prompts:manage", "virtualKeys:create"],
  },
  {
    teamRole: "VIEWER",
    name: "Viewer",
    description: "Read everything the team has, and change none of it.",
    inheritsFrom: null,
    headline: ["traces:view", "analytics:view", "datasets:view"],
  },
];

/** Every permission a built-in role holds, as the viewer reads membership. */
export function builtinRoleGrantedPermissions(
  teamRole: BuiltinRoleCard["teamRole"],
): AuthzPermission[] {
  return [...builtinRolePermissions(roleKeyForTeamRole(teamRole))] as AuthzPermission[];
}

/**
 * How many people hold a built-in role, counting those who hold it through a
 * group as well as those granted it directly. A custom role of the same tier
 * is not the built-in one.
 */
export function peopleHoldingBuiltinRole({
  bindings,
  teamRole,
}: {
  bindings: readonly RoleBinding[];
  teamRole: BuiltinRoleCard["teamRole"];
}): number {
  const people = new Set<string>();
  for (const binding of bindings) {
    if (binding.customRoleId || binding.role !== teamRole) continue;
    if (binding.userId) people.add(binding.userId);
    for (const memberId of binding.memberUserIds) people.add(memberId);
  }
  return people.size;
}

// Built-in roles from contract; parity-tested against engine; unit test catches omissions.

import { type AuthzPermission } from "@langwatch/authorization";
import {
  BILLING_ROLE_KEY,
  builtinRolePermissions,
  roleKeyForTeamRole,
  type TeamUserRole,
} from "@langwatch/authz-contract";

import type { ManagedGrant } from "./managed-grant.ts";

/** The dot a built-in role's row and drawer lead with, as a design-system colour palette. */
export type RoleDotPalette = "orange" | "green" | "gray" | "blue";

/** One built-in role, as the page presents it. */
export type BuiltinRoleCard = {
  /** The address the role's drawer carries: `?drawer.role=<key>`. */
  key: "admin" | "member" | "viewer";
  /** The legacy team role, which is what the permission lookup is keyed on. */
  teamRole: Extract<TeamUserRole, "ADMIN" | "MEMBER" | "VIEWER">;
  name: string;
  description: string;
  dot: RoleDotPalette;
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
    key: "admin",
    teamRole: "ADMIN",
    name: "Admin",
    description: "Everything Member can do, plus teams, projects and model providers.",
    dot: "orange",
    inheritsFrom: "Member",
    headline: ["team:manage", "project:delete", "gatewayProviders:manage"],
  },
  {
    key: "member",
    teamRole: "MEMBER",
    name: "Member",
    description: "Creates and changes traces, datasets, prompts, evaluations and keys.",
    dot: "green",
    inheritsFrom: "Viewer",
    headline: ["datasets:manage", "prompts:manage", "virtualKeys:create"],
  },
  {
    key: "viewer",
    teamRole: "VIEWER",
    name: "Viewer",
    description: "Reads everything the team has and changes none of it.",
    dot: "gray",
    inheritsFrom: null,
    headline: ["traces:view", "analytics:view", "datasets:view"],
  },
];

/** The Billing role: the last row of the list, read like the others. */
export const BILLING_ROLE_CARD = {
  key: "billing",
  name: "Billing",
  description: "Pays: plan, seats, invoices and seat requests.",
  dot: "blue",
  headline: ["subscription:manage", "seatRequests:manage", "members:view"],
} as const;

/** Every permission the Billing role holds. */
export function billingRoleGrantedPermissions(): AuthzPermission[] {
  return [...builtinRolePermissions(BILLING_ROLE_KEY)] as AuthzPermission[];
}

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
  bindings: readonly ManagedGrant[];
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

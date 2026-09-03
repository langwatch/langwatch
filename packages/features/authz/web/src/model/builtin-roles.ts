/**
 * The three built-in roles the Roles page shows beside an organization's custom
 * ones, and what each of them can do.
 *
 * REBUILT ON THE CONTRACT, NOT MOVED. The platform page read
 * `getTeamRolePermissions` out of `~/server/api/rbac`, a 2,239-line server
 * module that reaches the engine gate and, through it, a Node-only logger —
 * which is why `~/utils/rbacVocabulary` exists at all, and why `apps/ui` bans
 * `~/server` outright. `@langwatch/authz-contract` publishes the same answer as
 * `builtinRolePermissions(roleKeyForTeamRole(role))`, and its own docblock
 * records that the two are parity-tested cell for cell
 * (`platform/app/src/server/app-layer/authz/__tests__/roles-parity.unit.test.ts`),
 * so this is the fix the agents family made for the copy-target picker rather
 * than a second opinion about role membership.
 *
 * THE TWO SETS ARE NOT CHARACTER-IDENTICAL, and the difference is invisible
 * here. The contract's `admin` set lists `langy:create`, `langy:update` and
 * `langy:delete` explicitly where the legacy bag left them to `langy:manage`
 * and the hierarchy rule; `langy` is not a resource the permission catalogue
 * offers, so no viewer has ever rendered a row for any of the three.
 * `__tests__/builtin-roles.unit.test.ts` pins the property that makes this safe
 * in general — over every permission the catalogue DOES offer, membership of
 * the bag and the engine's hierarchy-aware verdict agree — so a bag that ever
 * omitted an implied permission would fail here rather than quietly
 * under-report what a built-in role can do.
 */

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
 * The three cards, in the order the page lists them.
 *
 * The description is stated ONCE. The platform page carried it twice — on the
 * card and again in `getDefaultRoleDescription`, which the permissions dialog
 * called with the card's own name and answered from a parallel switch — so the
 * two could disagree and the dialog would win.
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

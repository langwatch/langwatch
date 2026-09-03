/**
 * The three built-in roles, rebuilt on `@langwatch/authz-contract` instead of
 * `~/server/api/rbac`.
 *
 * WHAT THIS ACTUALLY PROTECTS. The dialog reads RAW membership — a permission
 * appears because the bag lists it, not because the engine would grant it — and
 * the bags DO lean on the hierarchy: every built-in role holds
 * `annotations:manage` without `annotations:create` beside it. That is not a
 * gap, because a resource showing `manage` is rendered as
 * "Manage (Create, Update, Delete)" and says the same thing. So the invariant
 * worth pinning is the one the reader actually depends on: nothing the engine
 * grants is missing from the dialog UNLESS the resource's `manage` is there to
 * say it, and nothing appears that the engine would not grant.
 *
 * Spec: specs/rbac/custom-role-permission-editing.feature
 */

import { builtinRoleGrants, roleKeyForTeamRole } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { BUILTIN_ROLE_CARDS, builtinRoleGrantedPermissions } from "../builtin-roles";
import { ORDERED_RESOURCES, permissionsForResource } from "../permission-catalogue";

const OFFERED = ORDERED_RESOURCES.flatMap((resource) => permissionsForResource(resource));

describe("the built-in roles", () => {
  describe.each(BUILTIN_ROLE_CARDS)("given the $name role", (card) => {
    /** @scenario A built-in role's permissions dialog under-reports nothing */
    it("shows every offered permission the engine grants, itself or through manage", () => {
      const listed = new Set(builtinRoleGrantedPermissions(card.teamRole));
      const underReported = OFFERED.filter(
        (permission) =>
          builtinRoleGrants({ role: roleKeyForTeamRole(card.teamRole), permission }) &&
          !listed.has(permission) &&
          !listed.has(`${permission.split(":")[0]}:manage` as (typeof OFFERED)[number]),
      );

      expect(underReported).toEqual([]);
    });

    /** @scenario A built-in role's permissions dialog over-reports nothing */
    it("shows nothing the engine would refuse", () => {
      const overReported = builtinRoleGrantedPermissions(card.teamRole)
        .filter((permission) => OFFERED.includes(permission))
        .filter(
          (permission) =>
            !builtinRoleGrants({ role: roleKeyForTeamRole(card.teamRole), permission }),
        );

      expect(overReported).toEqual([]);
    });
  });

  /** @scenario The built-in roles are ordered widest first */
  it("grants strictly more the wider the role", () => {
    const [admin, member, viewer] = BUILTIN_ROLE_CARDS.map(
      (card) => new Set(builtinRoleGrantedPermissions(card.teamRole)),
    );

    for (const permission of viewer!) expect(member!.has(permission)).toBe(true);
    for (const permission of member!) expect(admin!.has(permission)).toBe(true);
    expect(admin!.size).toBeGreaterThan(member!.size);
    expect(member!.size).toBeGreaterThan(viewer!.size);
  });

  it("names each role once, with its own description", () => {
    const names = BUILTIN_ROLE_CARDS.map((card) => card.name);
    const descriptions = BUILTIN_ROLE_CARDS.map((card) => card.description);

    expect(new Set(names).size).toBe(names.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});

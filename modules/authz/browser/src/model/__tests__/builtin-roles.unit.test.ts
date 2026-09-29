/**
 * Built-in roles rebuilt on authz-contract. Dialog reads raw membership; pin
 * invariant: nothing engine grants is hidden, nothing appears that engine won't.
 */

import { builtinRoleGrants, roleKeyForTeamRole } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import {
  BUILTIN_ROLE_CARDS,
  builtinRoleGrantedPermissions,
  peopleHoldingBuiltinRole,
} from "../builtin-roles.ts";
import { ORDERED_RESOURCES, permissionsForResource } from "../permission-catalogue.ts";
import type { RoleBinding } from "../role-binding-principals.ts";

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

  describe.each(BUILTIN_ROLE_CARDS)("given the $name card", (card) => {
    it("headlines only permissions the role really grants", () => {
      const granted = new Set<string>(builtinRoleGrantedPermissions(card.teamRole));

      expect(card.headline.filter((permission) => !granted.has(permission))).toEqual([]);
    });
  });

  describe("when people are counted for a built-in role", () => {
    const held = (overrides: Partial<RoleBinding>): RoleBinding => ({
      id: "b",
      userId: null,
      userName: null,
      userEmail: null,
      userImage: null,
      groupId: null,
      groupName: null,
      groupScimSource: null,
      apiKeyId: null,
      apiKeyName: null,
      role: "ADMIN",
      customRoleId: null,
      customRoleName: null,
      scopeType: "ORGANIZATION",
      scopeId: "org-1",
      scopeName: null,
      memberUserIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    });

    it("counts a person once, direct or through a group, and skips custom roles", () => {
      const bindings = [
        held({ userId: "u1" }),
        held({ userId: "u1", scopeType: "TEAM" }),
        held({ groupId: "g1", memberUserIds: ["u1", "u2"] }),
        held({ userId: "u3", customRoleId: "role-1" }),
        held({ userId: "u4", role: "VIEWER" }),
      ];

      expect(peopleHoldingBuiltinRole({ bindings, teamRole: "ADMIN" })).toBe(2);
      expect(peopleHoldingBuiltinRole({ bindings, teamRole: "VIEWER" })).toBe(1);
      expect(peopleHoldingBuiltinRole({ bindings, teamRole: "MEMBER" })).toBe(0);
    });
  });
});

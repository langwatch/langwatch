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
import type { ManagedGrant } from "../managed-grant.ts";
import { ORDERED_RESOURCES } from "../permission-catalogue.ts";
import { offeredPermissions } from "../role-permissions.ts";

const OFFERED = ORDERED_RESOURCES.flatMap((resource) => offeredPermissions(resource));

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

  describe("when a card claims what a tier can do", () => {
    const granted = (teamRole: "ADMIN" | "MEMBER" | "VIEWER") =>
      new Set<string>(builtinRoleGrantedPermissions(teamRole));

    /** @scenario A predefined role card describes the role it actually is */
    it("says Viewer changes nothing, and Viewer can change nothing", () => {
      const viewer = BUILTIN_ROLE_CARDS.find((card) => card.teamRole === "VIEWER");

      expect(viewer?.description).toContain("change none of it");
      for (const permission of granted("VIEWER")) {
        expect(permission.endsWith(":view")).toBe(true);
      }
    });

    /** @scenario A predefined role card describes the role it actually is */
    it("says Member creates and changes the work, and stops short of the team", () => {
      const member = granted("MEMBER");

      expect(member.has("datasets:manage")).toBe(true);
      expect(member.has("prompts:manage")).toBe(true);
      expect(member.has("evaluations:manage")).toBe(true);
      expect(member.has("experiments:manage")).toBe(true);
      expect(member.has("traces:create")).toBe(true);
      expect(member.has("virtualKeys:create")).toBe(true);

      expect(member.has("team:manage")).toBe(false);
      expect(member.has("project:delete")).toBe(false);
    });

    /** @scenario A predefined role card describes the role it actually is */
    it("says Admin holds the team, its projects and the gateway, and it does", () => {
      const admin = granted("ADMIN");

      expect(admin.has("team:manage")).toBe(true);
      expect(admin.has("project:manage")).toBe(true);
      expect(admin.has("project:delete")).toBe(true);
      expect(admin.has("gatewayProviders:manage")).toBe(true);
      expect(admin.has("gatewayBudgets:manage")).toBe(true);
    });

    /** @scenario A predefined role card describes the role it actually is */
    it("leads each tier above the base with something the tier below lacks", () => {
      for (const card of BUILTIN_ROLE_CARDS) {
        const below = BUILTIN_ROLE_CARDS.find((candidate) => candidate.name === card.inheritsFrom);
        if (!below) continue;
        const inherited = granted(below.teamRole);

        expect(card.headline.filter((permission) => inherited.has(permission))).toEqual([]);
      }
    });
  });

  describe("when people are counted for a built-in role", () => {
    const held = (overrides: Partial<ManagedGrant>): ManagedGrant => ({
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

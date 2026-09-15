/**
 * The create response's stand-in for a projection that has not caught up.
 *
 * @see specs/rbac/role-bindings-rest-api.feature
 */
import { describe, expect, it } from "vitest";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { optimisticBindingWire } from "../[[...route]]/read-back";

const AT = new Date("2026-08-18T09:00:00.000Z");

describe("the binding a create answers with while the projection lags", () => {
  describe("when the create is for a user", () => {
    it("carries the id the write minted and the facts the request stated", () => {
      const wire = optimisticBindingWire({
        id: "rb_1",
        principal: { userId: "user_1" },
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: "team_1",
        now: () => AT,
      });

      expect(wire).toEqual({
        id: "rb_1",
        principal: { type: "user", id: "user_1", name: null },
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        customRoleName: null,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: "team_1",
        scopeName: null,
        createdAt: AT,
        expiresAt: null,
      });
    });
  });

  describe("when the create states the date its access ends", () => {
    it("echoes it back rather than leaving the caller to guess", () => {
      const endsAt = new Date("2026-12-31T23:59:59.000Z");
      const wire = optimisticBindingWire({
        id: "rb_5",
        principal: { userId: "user_1" },
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: "team_1",
        expiresAt: endsAt,
        now: () => AT,
      });

      // Unlike the names, this is something the request stated rather than
      // something the listing joins in, so the optimistic answer knows it.
      expect(wire.expiresAt).toEqual(endsAt);
    });
  });

  describe("when the create is for a group", () => {
    it("names the group as the principal", () => {
      const wire = optimisticBindingWire({
        id: "rb_2",
        principal: { groupId: "group_1" },
        role: TeamUserRole.VIEWER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: "org_1",
        now: () => AT,
      });

      expect(wire.principal).toEqual({
        type: "group",
        id: "group_1",
        name: null,
      });
    });
  });

  describe("when the create is for an API key", () => {
    it("names the key as the principal", () => {
      const wire = optimisticBindingWire({
        id: "rb_3",
        principal: { apiKeyId: "apikey_1" },
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: "project_1",
        now: () => AT,
      });

      expect(wire.principal).toEqual({
        type: "apiKey",
        id: "apikey_1",
        name: null,
      });
    });
  });

  describe("when the create carries a custom role", () => {
    it("keeps the role id the caller asked for and leaves its name unresolved", () => {
      const wire = optimisticBindingWire({
        id: "rb_4",
        principal: { userId: "user_1" },
        role: TeamUserRole.CUSTOM,
        customRoleId: "role_1",
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: "project_1",
        now: () => AT,
      });

      expect(wire.customRoleId).toBe("role_1");
      expect(wire.customRoleName).toBeNull();
    });
  });
});

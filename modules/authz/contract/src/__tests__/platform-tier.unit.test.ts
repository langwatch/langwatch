/**
 * @see specs/rbac/platform-operators.feature
 */
import { describe, expect, it } from "vitest";

import { authzCanInputSchema } from "../authz.queries.ts";
import { builtinRolePermissions, PLATFORM_OPERATOR_ROLE_ID } from "../roles.ts";
import { bindingScopeCanGrantPermission } from "../scope.ts";

describe("the platform tier", () => {
  describe("given a binding at an organization, team or project", () => {
    /** @scenario A custom role carrying ops permissions confers nothing */
    it.each(["ORGANIZATION", "TEAM", "PROJECT"] as const)(
      "never grants an ops permission from %s",
      (scopeType) => {
        expect(bindingScopeCanGrantPermission({ scopeType, permission: "ops:view" })).toBe(false);
        expect(bindingScopeCanGrantPermission({ scopeType, permission: "ops:manage" })).toBe(false);
      },
    );
  });

  describe("given the built-in platform-operator role", () => {
    /** @scenario The platform grant confers nothing but ops permissions */
    it("carries ops:view and ops:manage and nothing else", () => {
      expect([...builtinRolePermissions(PLATFORM_OPERATOR_ROLE_ID)].toSorted()).toEqual([
        "ops:manage",
        "ops:view",
      ]);
    });
  });

  describe("when `can` is asked at the platform", () => {
    /** @scenario A platform operator holds ops permissions at the platform */
    it("accepts a platform scope with no organization", () => {
      const parsed = authzCanInputSchema.safeParse({
        principal: { type: "user", id: "user_1" },
        permission: "ops:view",
        scope: { type: "platform" },
      });

      expect(parsed.success).toBe(true);
    });
  });
});

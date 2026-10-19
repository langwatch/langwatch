/**
 * What a platform-operator grant can carry: the account, never a role, permission or scope.
 * Spec: modules/ops/specs/platform-operator-bootstrap.feature
 */
import {
  authzGrantPlatformOperatorInputSchema,
  builtinRolePermissions,
  PLATFORM_OPERATOR_PERMISSIONS,
  PLATFORM_OPERATOR_ROLE_ID,
} from "@langwatch/authz-contract";
import { opsGrantPlatformOperatorInputSchema } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

const ADDRESS = "operator@acme.test";

const AUTHZ_GRANT = {
  principal: { type: "user", id: "user_target" },
  caller: { type: "system" },
  actor: { type: "system", id: null },
} as const;

describe("a platform-operator grant", () => {
  describe("when the page is asked to grant with more than the address", () => {
    /** @scenario "A grant names the account and nothing more" */
    it.each([
      { role: "admin" },
      { roleKey: "platform-operator" },
      { permissions: ["ops:view", "ops:manage", "licenses:manage"] },
      { scope: { type: "PLATFORM", id: "platform" } },
    ])("refuses the input carrying %o", (extra) => {
      expect(opsGrantPlatformOperatorInputSchema.validate({ email: ADDRESS, ...extra })).toBe(
        false,
      );
    });

    /** @scenario "A grant names the account and nothing more" */
    it("accepts the address alone", () => {
      expect(opsGrantPlatformOperatorInputSchema.validate({ email: ADDRESS })).toBe(true);
    });
  });

  describe("when authz is asked to grant with more than the account", () => {
    /** @scenario "A grant names the account and nothing more" */
    it.each([
      { roleKey: "admin" },
      { permissions: ["ops:view"] },
      { scope: { type: "ORGANIZATION", id: "org_1" } },
    ])("refuses the input carrying %o", (extra) => {
      expect(authzGrantPlatformOperatorInputSchema.validate({ ...AUTHZ_GRANT, ...extra })).toBe(
        false,
      );
    });

    /** @scenario "A grant names the account and nothing more" */
    it("accepts the account, caller and actor alone", () => {
      expect(authzGrantPlatformOperatorInputSchema.validate(AUTHZ_GRANT)).toBe(true);
    });
  });

  describe("given the role every grant path writes", () => {
    /** @scenario "A grant names the account and nothing more" */
    it("confers ops:view and ops:manage and nothing else", () => {
      expect(PLATFORM_OPERATOR_PERMISSIONS.toSorted()).toEqual(["ops:manage", "ops:view"]);
      expect([...builtinRolePermissions(PLATFORM_OPERATOR_ROLE_ID)].toSorted()).toEqual([
        "ops:manage",
        "ops:view",
      ]);
    });
  });
});

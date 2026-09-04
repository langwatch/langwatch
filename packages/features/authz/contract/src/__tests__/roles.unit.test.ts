// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Built-in role permission resolution. Ported from
 * platform/app/src/hooks/__tests__/isOrgScopedPermission.unit.test.ts
 * (retired application): that hook classified a permission as org- or
 * team-scoped before routing the check; role-vs-permission resolution now
 * runs through `builtinRoleGrants` directly, so the org-admin role granting
 * webhook and spend permissions is what stands in for "org-scoped" here.
 */
import { describe, expect, it } from "vitest";
import { builtinRoleGrants } from "../roles";

describe("builtinRoleGrants", () => {
  describe("given a user with an organization admin role", () => {
    /** @scenario Webhook management is an organization-scoped permission */
    it("resolves the webhook and spend permissions against the org role", () => {
      expect(builtinRoleGrants({ role: "org-admin", permission: "webhookEndpoints:view" })).toBe(
        true,
      );
      expect(
        builtinRoleGrants({ role: "org-admin", permission: "webhookEndpoints:manage" }),
      ).toBe(true);
      expect(builtinRoleGrants({ role: "org-admin", permission: "gatewaySpend:view" })).toBe(
        true,
      );
      expect(builtinRoleGrants({ role: "org-admin", permission: "gatewaySpend:manage" })).toBe(
        true,
      );
    });

    it("does not grant webhook management to the plain org-member role", () => {
      expect(
        builtinRoleGrants({ role: "org-member", permission: "webhookEndpoints:manage" }),
      ).toBe(false);
    });
  });
});

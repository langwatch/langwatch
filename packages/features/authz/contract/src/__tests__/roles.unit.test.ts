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
import { builtinRoleGrants, builtinRolePermissions } from "../roles";

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

/**
 * Langy has its own permission family rather than riding on
 * `evaluations:view`. Starting a turn is not a read: it provisions
 * credentials, spawns a coding-agent worker and spends the project's model
 * budget, so it must not be buyable with a view grant.
 */
describe("Langy permissions", () => {
  describe("given a project viewer", () => {
    /** @scenario "Below member, Langy is not granted at all" */
    it.each(["langy:view", "langy:create", "langy:update", "langy:delete", "langy:manage"] as const)(
      "does not hold %s",
      (permission) => {
        expect(builtinRoleGrants({ role: "viewer", permission })).toBe(false);
      },
    );
  });

  describe("given a project member", () => {
    it("can read and act on Langy conversations", () => {
      expect(builtinRoleGrants({ role: "member", permission: "langy:view" })).toBe(true);
      expect(builtinRoleGrants({ role: "member", permission: "langy:create" })).toBe(true);
    });

    /** @scenario "A member can run Langy but cannot administer it" */
    it("cannot administer Langy", () => {
      expect(builtinRoleGrants({ role: "member", permission: "langy:manage" })).toBe(false);
    });
  });

  describe("given a project admin", () => {
    it("administers Langy via the manage hierarchy", () => {
      expect(builtinRoleGrants({ role: "admin", permission: "langy:manage" })).toBe(true);
      expect(builtinRoleGrants({ role: "admin", permission: "langy:create" })).toBe(true);
    });
  });
});

/**
 * Ported from platform/app's rbac.test.ts: experiments carries its own
 * permission string rather than being derived from workflows at read time,
 * but every built-in role that grants one grants the other, because the
 * product surfaces them together.
 */
describe("experiments permission", () => {
  /** @scenario "Experiments use a dedicated permission decoupled from workflows" */
  it("tracks workflows:view / workflows:manage as a dedicated permission for every built-in role", () => {
    for (const role of ["viewer", "member", "admin"] as const) {
      const perms = builtinRolePermissions(role);
      expect(perms.has("experiments:view")).toBe(perms.has("workflows:view"));
      expect(perms.has("experiments:manage")).toBe(perms.has("workflows:manage"));
    }
  });
});

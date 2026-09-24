/**
 * The Enterprise plan gate as the application applies it: defining, rewriting
 * and handing out a role are gated; taking one back and deleting one are not,
 * so an organization that leaves the plan can still clean up.
 */
import { ROLE_KIND, type Role } from "@langwatch/role-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryRoleRepository } from "../../repositories/memory/memory.role.repository.ts";
import { createRoleTestApp, testBinding, testPlan } from "./role.fixture.ts";

const ORGANIZATION_ID = "org-1";
const CALLER = { id: "user-1" };
const NOT_IN_PLAN = /Enterprise plan/;

const role: Role = {
  id: "role-1",
  organizationId: ORGANIZATION_ID,
  name: "Reviewer",
  description: null,
  permissions: ["traces:view"],
  kind: ROLE_KIND.CUSTOM,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function harness(planType: "FREE" | "ENTERPRISE") {
  const roles = MemoryRoleRepository.create();
  roles.save(role);
  const permissions = {
    defineRole: vi.fn(async () => {}),
    deleteRole: vi.fn(async () => {}),
    changeBindingRole: vi.fn(async () => {}),
    attachBindings: vi.fn(async () => ({ attached: [], duplicates: [] })),
    hasPermission: vi.fn(async () => true),
    listOrganizationBindings: vi.fn(async () => []),
    listUserBindings: vi.fn(async () => [testBinding()]),
  };
  const getActivePlan = vi.fn(async () => testPlan({ type: planType }));

  const { app } = createRoleTestApp({
    roles,
    entitlement: { getActivePlan },
    permissions,
    organizations: { getOrganizationIdByTeamId: async () => ORGANIZATION_ID },
  });

  return { app, permissions, getActivePlan };
}

describe("given an organization whose plan is not ENTERPRISE", () => {
  describe("when an administrator defines a custom role", () => {
    /** @scenario "Non-enterprise org cannot create custom roles" */
    it("refuses before the definition is written", async () => {
      const { app, permissions } = harness("FREE");

      await expect(
        app.createRole(
          { role: { organizationId: ORGANIZATION_ID, name: "Auditor", permissions: [] } },
          CALLER,
        ),
      ).rejects.toThrowError(NOT_IN_PLAN);
      expect(permissions.defineRole).not.toHaveBeenCalled();
    });
  });

  describe("when an administrator rewrites a custom role", () => {
    /** @scenario "Non-enterprise org cannot update custom roles" */
    it("refuses before the definition is rewritten", async () => {
      const { app, permissions } = harness("FREE");

      await expect(
        app.updateRole({ roleId: role.id, changes: { name: "Auditor" } }, CALLER),
      ).rejects.toThrowError(NOT_IN_PLAN);
      expect(permissions.defineRole).not.toHaveBeenCalled();
    });
  });

  describe("when an administrator hands a custom role to a team member", () => {
    /** @scenario "Non-enterprise org cannot assign custom roles to users" */
    it("refuses before a grant is written", async () => {
      const { app, permissions } = harness("FREE");

      await expect(
        app.assignRoleToUser({ userId: "user-2", teamId: "team-1", customRoleId: role.id }, CALLER),
      ).rejects.toThrowError(NOT_IN_PLAN);
      expect(permissions.changeBindingRole).not.toHaveBeenCalled();
      expect(permissions.attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when an administrator takes a custom role away again", () => {
    /** @scenario "Non-enterprise org can remove custom roles from users" */
    it("removes it without consulting the plan, reverting the member to VIEWER", async () => {
      const { app, permissions, getActivePlan } = harness("FREE");

      await expect(
        app.removeRoleFromUser({ userId: "user-2", teamId: "team-1" }, CALLER),
      ).resolves.toEqual({ success: true });
      expect(permissions.changeBindingRole).toHaveBeenCalledWith(
        expect.objectContaining({ role: "VIEWER", customRoleId: null }),
      );
      expect(getActivePlan).not.toHaveBeenCalled();
    });
  });

  describe("when an administrator deletes a role left over from Enterprise", () => {
    /** @scenario "Non-enterprise org can delete custom roles for cleanup" */
    it("deletes it without consulting the plan", async () => {
      const { app, permissions, getActivePlan } = harness("FREE");

      await expect(app.deleteRole({ roleId: role.id }, CALLER)).resolves.toEqual({
        success: true,
      });
      expect(permissions.deleteRole).toHaveBeenCalled();
      expect(getActivePlan).not.toHaveBeenCalled();
    });
  });

  describe("when a member reads one custom role", () => {
    /** @scenario "Non-enterprise org can view a custom role" */
    it("answers with the role details", async () => {
      const { app, getActivePlan } = harness("FREE");

      await expect(app.getRole({ roleId: role.id }, CALLER)).resolves.toMatchObject({
        id: role.id,
        name: "Reviewer",
      });
      expect(getActivePlan).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization on the ENTERPRISE plan", () => {
  describe("when an administrator defines a custom role", () => {
    /** @scenario "Enterprise org can create custom roles" */
    it("writes the definition through the grants ledger", async () => {
      const { app, permissions } = harness("ENTERPRISE");

      await expect(
        app.createRole(
          {
            role: {
              organizationId: ORGANIZATION_ID,
              name: "Auditor",
              permissions: ["traces:view"],
            },
          },
          CALLER,
        ),
      ).resolves.toMatchObject({ name: "Auditor", kind: ROLE_KIND.CUSTOM });
      expect(permissions.defineRole).toHaveBeenCalled();
    });
  });
});

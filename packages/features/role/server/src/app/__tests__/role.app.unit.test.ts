import type { AuthzApi } from "@langwatch/authz-contract";
import { PermissionDeniedError } from "@langwatch/authz-contract";
import {
  OrgExclusivePermissionScopeError,
  RoleInUseError,
  RoleNotFoundError,
  RoleTeamNotFoundError,
  ROLE_KIND,
  type Role,
} from "@langwatch/role-contract";
import { describe, expect, it, vi } from "vitest";
import { MemoryRoleRepository } from "../../repositories/memory/memory.role.repository.ts";
import { createRoleTestApp, testBinding } from "./role.fixture.ts";

const ORGANIZATION_ID = "org-1";
const CALLER = { id: "user-1" };

const role = (overrides: Partial<Role> = {}): Role => ({
  id: "role-1",
  organizationId: ORGANIZATION_ID,
  name: "Reviewer",
  description: null,
  permissions: ["traces:view"],
  kind: ROLE_KIND.CUSTOM,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

/** No binding of any kind, which is what an unheld role looks like. */
const noBindings = { listOrganizationBindings: async () => [] } as Partial<AuthzApi>;

describe("given a caller defining a custom role", () => {
  describe("when the name is free and every permission is valid", () => {
    /** @scenario "A caller defines a custom role" */
    it("writes the definition through the grants ledger and answers with it", async () => {
      const defineRole = vi.fn(async () => {});
      const { app } = createRoleTestApp({ permissions: { defineRole } });

      const created = await app.createRole(
        {
          role: {
            organizationId: ORGANIZATION_ID,
            name: "Reviewer",
            permissions: ["traces:view"],
          },
        },
        CALLER,
      );

      expect(created.organizationId).toBe(ORGANIZATION_ID);
      expect(created.kind).toBe(ROLE_KIND.CUSTOM);
      expect(defineRole).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          name: "Reviewer",
          permissions: ["traces:view"],
          actor: { type: "user", id: CALLER.id },
        }),
      );
    });
  });

  describe("when a role in the organization already holds the name", () => {
    /** @scenario "A role name is already taken in the organization" */
    it("refuses before anything is written", async () => {
      const defineRole = vi.fn(async () => {});
      const roles = MemoryRoleRepository.create();
      roles.save(role());
      const { app } = createRoleTestApp({ roles, permissions: { defineRole } });

      await expect(
        app.createRole(
          {
            role: {
              organizationId: ORGANIZATION_ID,
              name: "Reviewer",
              permissions: ["traces:view"],
            },
          },
          CALLER,
        ),
      ).rejects.toMatchObject({ code: "custom_role_name_taken" });
      expect(defineRole).not.toHaveBeenCalled();
    });
  });
});

describe("given a role that belongs to another organization", () => {
  describe("when an organization-scoped operation names it", () => {
    /** @scenario "A role is requested from another organization" */
    it("answers the same not-found as for a role that never existed", async () => {
      const roles = MemoryRoleRepository.create();
      roles.save(role());
      const { app } = createRoleTestApp({ roles });

      await expect(
        app.getRoleInOrganization({ roleId: "role-1", organizationId: "org-2" }),
      ).rejects.toBeInstanceOf(RoleNotFoundError);
      await expect(
        app.getRoleInOrganization({ roleId: "absent", organizationId: ORGANIZATION_ID }),
      ).rejects.toBeInstanceOf(RoleNotFoundError);
    });
  });
});

describe("given a caller reading one role by its id", () => {
  describe("when the organization decision refuses them", () => {
    /** @scenario "A caller the organization decision refuses reaches no role data" */
    it("refuses with the permission-denied code", async () => {
      const roles = MemoryRoleRepository.create();
      roles.save(role());
      const { app } = createRoleTestApp({
        roles,
        permissions: { hasPermission: async () => false },
      });

      await expect(app.getRole({ roleId: "role-1" }, CALLER)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });
  });
});

describe("given a role that carries an organization-exclusive permission", () => {
  describe("when a caller assigns it on a team", () => {
    /** @scenario "A caller assigns a role below organization scope" */
    it("refuses before a grant is written", async () => {
      const attachBindings = vi.fn(async () => ({ attached: [], duplicates: [] }));
      const roles = MemoryRoleRepository.create();
      roles.save(role({ permissions: ["organization:manage"] }));
      const { app } = createRoleTestApp({
        roles,
        organizations: { tryGetOrganizationIdByTeamId: async () => ORGANIZATION_ID },
        permissions: { attachBindings },
      });

      await expect(
        app.assignRoleToUser(
          { userId: "user-2", teamId: "team-1", customRoleId: "role-1" },
          CALLER,
        ),
      ).rejects.toBeInstanceOf(OrgExclusivePermissionScopeError);
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });
});

describe("given a team assignment being authorized", () => {
  describe("when the organization is resolved from the team identifier", () => {
    /** @scenario "A transport authorizes a team assignment" */
    it("reads the organization directory, and an absent team is a refusal", async () => {
      const tryGetOrganizationIdByTeamId = vi.fn(async (input: { teamId: string }) =>
        input.teamId === "team-1" ? ORGANIZATION_ID : null,
      );
      const { app } = createRoleTestApp({
        organizations: { tryGetOrganizationIdByTeamId },
      });

      await expect(app.getAssignmentOrganization({ teamId: "team-1" })).resolves.toBe(
        ORGANIZATION_ID,
      );
      await expect(
        app.getAssignmentOrganization({ teamId: "missing-team" }),
      ).rejects.toBeInstanceOf(RoleTeamNotFoundError);
    });
  });
});

describe("given a role something still holds", () => {
  describe("when a caller removes it", () => {
    /** @scenario "A role still has holders" */
    it("refuses with the role-in-use error", async () => {
      const deleteRole = vi.fn(async () => {});
      const roles = MemoryRoleRepository.create();
      roles.save(role());
      roles.assign({ userId: "user-2", teamId: "team-1", customRoleId: "role-1" });
      const { app } = createRoleTestApp({
        roles,
        permissions: { ...noBindings, deleteRole },
      });

      await expect(
        app.deleteRoleInOrganization(
          { roleId: "role-1", organizationId: ORGANIZATION_ID },
          CALLER,
        ),
      ).rejects.toBeInstanceOf(RoleInUseError);
      expect(deleteRole).not.toHaveBeenCalled();
    });
  });
});

describe("given a deletion that races a new holder", () => {
  describe("when a binding appears after the first check", () => {
    /** @scenario "A role deletion races with a new holder" */
    it("reports that the role is in use rather than deleting it", async () => {
      const deleteRole = vi.fn(async () => {});
      const roles = MemoryRoleRepository.create();
      roles.save(role());
      let seen = 0;
      const listOrganizationBindings = vi.fn(async () => {
        seen += 1;

        return seen === 1 ? [] : [testBinding({ customRoleId: "role-1" })];
      });
      const { app } = createRoleTestApp({
        roles,
        permissions: { listOrganizationBindings, deleteRole },
      });

      await expect(
        app.deleteRoleInOrganization(
          { roleId: "role-1", organizationId: ORGANIZATION_ID },
          CALLER,
        ),
      ).rejects.toMatchObject({ code: "custom_role_in_use", bindingCount: 1 });
      expect(deleteRole).not.toHaveBeenCalled();
    });
  });
});

describe("given another feature validating a custom role", () => {
  describe("when it asks which of a set this organization may assign", () => {
    /** @scenario "Another feature needs custom-role behaviour" */
    it("answers through the role application rather than a shared query", async () => {
      const roles = MemoryRoleRepository.create();
      roles.save(role());
      roles.save(role({ id: "role-2", organizationId: "org-2", name: "Other" }));
      const { app } = createRoleTestApp({ roles });

      await expect(
        app.filterAssignableRoles({
          roleIds: ["role-1", "role-2"],
          organizationId: ORGANIZATION_ID,
        }),
      ).resolves.toEqual(["role-1"]);
    });
  });
});

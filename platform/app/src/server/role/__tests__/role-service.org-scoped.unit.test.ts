/**
 * Unit tests for the organization-scoped RoleService variants. The tRPC
 * router loads a role blind and re-checks the caller's permission on its
 * organization afterwards; the REST surface authenticates as one
 * organization up front, so these lookups must never return or affect
 * another organization's role.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { RoleService } from "../role.service";

function buildMockPrisma() {
  return {
    customRole: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    roleBinding: {
      count: vi.fn(),
    },
    teamUser: {
      count: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
    },
    // The delete carries its in-use condition, so it is a single statement
    // rather than a Prisma model call.
    $executeRaw: vi.fn(),
  };
}

const storedRole = {
  id: "cr_1",
  organizationId: "org_1",
  name: "editors",
  description: null,
  kind: "custom",
  permissions: ["traces:view"],
  assignedUsers: [],
};

describe("RoleService org-scoped variants", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let service: RoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = buildMockPrisma();
    service = new RoleService(prisma as unknown as PrismaClient);
  });

  describe("when reading a role by organization", () => {
    it("scopes the lookup to the organization and the custom kind", async () => {
      prisma.customRole.findFirst.mockResolvedValue(storedRole);

      const role = await service.getRoleForOrg({
        roleId: "cr_1",
        organizationId: "org_1",
      });

      expect(prisma.customRole.findFirst).toHaveBeenCalledWith({
        where: { id: "cr_1", organizationId: "org_1", kind: "custom" },
      });
      expect(role.permissions).toEqual(["traces:view"]);
    });

    it("answers not found for another organization's role", async () => {
      prisma.customRole.findFirst.mockResolvedValue(null);

      await expect(
        service.getRoleForOrg({ roleId: "cr_1", organizationId: "org_2" }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });
    });
  });

  describe("when updating a role by organization", () => {
    it("answers not found before writing when the role is foreign", async () => {
      prisma.customRole.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_2",
          params: { name: "renamed" },
        }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });

      expect(prisma.customRole.update).not.toHaveBeenCalled();
    });

    it("refuses a rename onto an existing role name", async () => {
      prisma.customRole.findFirst.mockResolvedValue(storedRole);
      prisma.customRole.findUnique.mockResolvedValue({ id: "cr_other" });

      await expect(
        service.updateRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_1",
          params: { name: "taken-name" },
        }),
      ).rejects.toMatchObject({ code: "custom_role_name_taken" });

      expect(prisma.customRole.update).not.toHaveBeenCalled();
    });

    it("refuses the reserved API key namespace", async () => {
      await expect(
        service.updateRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_1",
          params: { name: "apikey:sneaky" },
        }),
      ).rejects.toMatchObject({ code: "custom_role_name_reserved" });
    });

    it("updates a role of its own organization", async () => {
      prisma.customRole.findFirst.mockResolvedValue(storedRole);
      prisma.customRole.findUnique.mockResolvedValue(null);
      prisma.customRole.update.mockResolvedValue({
        ...storedRole,
        name: "renamed",
      });

      const updated = await service.updateRoleForOrg({
        roleId: "cr_1",
        organizationId: "org_1",
        params: { name: "renamed" },
      });

      expect(updated.name).toBe("renamed");
    });
  });

  describe("when deleting a role by organization", () => {
    it("answers not found for another organization's role", async () => {
      prisma.customRole.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteRoleForOrg({ roleId: "cr_1", organizationId: "org_2" }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("refuses to delete a role that role bindings still reference", async () => {
      prisma.customRole.findFirst.mockResolvedValue(storedRole);
      prisma.roleBinding.count.mockResolvedValue(2);

      await expect(
        service.deleteRoleForOrg({ roleId: "cr_1", organizationId: "org_1" }),
      ).rejects.toMatchObject({
        code: "custom_role_in_use",
        meta: expect.objectContaining({ bindingCount: 2 }),
      });

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("deletes an unreferenced role", async () => {
      prisma.customRole.findFirst.mockResolvedValue(storedRole);
      prisma.roleBinding.count.mockResolvedValue(0);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.deleteRoleForOrg({
        roleId: "cr_1",
        organizationId: "org_1",
      });

      expect(result).toEqual({ success: true });
      const [, ...parameters] = prisma.$executeRaw.mock.calls[0]!;
      expect(parameters).toContain("cr_1");
      expect(parameters).toContain("org_1");
    });

    describe("when a binding is written between the check and the delete", () => {
      it("leaves the role standing and refuses with the fresh counts", async () => {
        prisma.customRole.findFirst.mockResolvedValue(storedRole);
        // The pre-check sees nothing; the re-read after the delete finds the
        // binding that arrived in between.
        prisma.roleBinding.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(1);
        prisma.teamUser.count.mockResolvedValue(0);
        // The condition rode with the statement, so nothing was deleted.
        prisma.$executeRaw.mockResolvedValue(0);

        await expect(
          service.deleteRoleForOrg({ roleId: "cr_1", organizationId: "org_1" }),
        ).rejects.toMatchObject({
          code: "custom_role_in_use",
          meta: expect.objectContaining({ bindingCount: 1 }),
        });
      });
    });

    describe("when another caller deleted the same role first", () => {
      it("answers not found rather than an in-use refusal naming nothing", async () => {
        // The lookup finds the role; the re-read after the failed delete
        // finds it gone, which is what says another caller removed it in
        // between. A 409 here would list zero users and zero bindings for a
        // role that no longer exists.
        prisma.customRole.findFirst
          .mockResolvedValueOnce(storedRole)
          .mockResolvedValueOnce(null);
        prisma.roleBinding.count.mockResolvedValue(0);
        prisma.teamUser.count.mockResolvedValue(0);
        prisma.$executeRaw.mockResolvedValue(0);

        await expect(
          service.deleteRoleForOrg({ roleId: "cr_1", organizationId: "org_1" }),
        ).rejects.toMatchObject({ code: "custom_role_not_found" });
      });
    });
  });

  describe("when the update loses a race on a unique index", () => {
    it("reports the duplicate name for a conflict on the name index", async () => {
      prisma.customRole.findFirst.mockResolvedValue(storedRole);
      prisma.customRole.findUnique.mockResolvedValue(null);
      prisma.customRole.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("conflict", {
          code: "P2002",
          clientVersion: "5.7.1",
          meta: { target: ["organizationId", "name"] },
        }),
      );

      await expect(
        service.updateRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_1",
          params: { name: "reviewers" },
        }),
      ).rejects.toMatchObject({ code: "custom_role_name_taken" });
    });

    it("lets a conflict on an unrelated index through unchanged", async () => {
      prisma.customRole.findFirst.mockResolvedValue(storedRole);
      prisma.customRole.findUnique.mockResolvedValue(null);
      const unrelated = new Prisma.PrismaClientKnownRequestError("conflict", {
        code: "P2002",
        clientVersion: "5.7.1",
        meta: { target: ["organizationId", "externalId"] },
      });
      prisma.customRole.update.mockRejectedValue(unrelated);

      await expect(
        service.updateRoleForOrg({
          roleId: "cr_1",
          organizationId: "org_1",
          params: { description: "anything" },
        }),
      ).rejects.toBe(unrelated);
    });
  });
});

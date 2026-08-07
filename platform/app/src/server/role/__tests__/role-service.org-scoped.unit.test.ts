/**
 * Unit tests for the organization-scoped RoleService variants. The tRPC
 * router loads a role blind and re-checks the caller's permission on its
 * organization afterwards; the REST surface authenticates as one
 * organization up front, so these lookups must never return or affect
 * another organization's role.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleService } from "../role.service";

function buildMockPrisma() {
  return {
    customRole: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    roleBinding: {
      count: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
    },
  } as any;
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
    service = new RoleService(prisma);
  });

  describe("getRoleForOrg()", () => {
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

  describe("updateRoleForOrg()", () => {
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

  describe("deleteRoleForOrg()", () => {
    it("answers not found for another organization's role", async () => {
      prisma.customRole.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteRoleForOrg({ roleId: "cr_1", organizationId: "org_2" }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });

      expect(prisma.customRole.delete).not.toHaveBeenCalled();
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

      expect(prisma.customRole.delete).not.toHaveBeenCalled();
    });

    it("deletes an unreferenced role", async () => {
      prisma.customRole.findFirst.mockResolvedValue(storedRole);
      prisma.roleBinding.count.mockResolvedValue(0);

      const result = await service.deleteRoleForOrg({
        roleId: "cr_1",
        organizationId: "org_1",
      });

      expect(result).toEqual({ success: true });
      expect(prisma.customRole.delete).toHaveBeenCalledWith({
        where: { id: "cr_1" },
      });
    });
  });
});

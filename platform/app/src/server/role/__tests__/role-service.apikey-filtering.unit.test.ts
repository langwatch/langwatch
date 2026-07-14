import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoleService } from "../role.service";
import { RoleReservedNameError, RoleNotFoundError } from "../errors";

function buildMockPrisma() {
  return {
    customRole: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
    },
  } as any;
}

describe("RoleService", () => {
  let prisma: ReturnType<typeof buildMockPrisma>;
  let service: RoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = buildMockPrisma();
    service = new RoleService(prisma);
  });

  describe("getAllRoles()", () => {
    it("queries with kind: custom", async () => {
      prisma.customRole.findMany.mockResolvedValue([]);

      await service.getAllRoles("org_1");

      expect(prisma.customRole.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_1", kind: "custom" },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("getRoleById()", () => {
    describe("when role is system_api_key kind", () => {
      it("throws RoleNotFoundError", async () => {
        prisma.customRole.findUnique.mockResolvedValue({
          id: "cr_1", name: "apikey:ak_1", kind: "system_api_key", permissions: [],
        });

        await expect(service.getRoleById("cr_1")).rejects.toThrow(RoleNotFoundError);
      });
    });

    describe("when role is custom kind", () => {
      it("returns the role", async () => {
        prisma.customRole.findUnique.mockResolvedValue({
          id: "cr_1", name: "Engineer", kind: "custom", permissions: ["traces:view"],
        });

        const result = await service.getRoleById("cr_1");
        expect(result.id).toBe("cr_1");
      });
    });
  });

  describe("updateRole()", () => {
    describe("when target role is system_api_key kind", () => {
      it("throws RoleNotFoundError", async () => {
        prisma.customRole.findUnique.mockResolvedValue({
          id: "cr_1", name: "apikey:ak_1", kind: "system_api_key", permissions: [],
        });

        await expect(
          service.updateRole("cr_1", { name: "hijacked" }),
        ).rejects.toThrow(RoleNotFoundError);

        expect(prisma.customRole.update).not.toHaveBeenCalled();
      });
    });

    describe("when renaming to reserved prefix", () => {
      it("throws RoleReservedNameError", async () => {
        await expect(
          service.updateRole("cr_1", { name: "apikey:sneaky" }),
        ).rejects.toThrow(RoleReservedNameError);
      });
    });
  });

  describe("deleteRole()", () => {
    describe("when target role is system_api_key kind", () => {
      it("throws RoleNotFoundError", async () => {
        prisma.customRole.findUnique.mockResolvedValue({
          id: "cr_1", name: "apikey:ak_1", kind: "system_api_key",
          permissions: [], assignedUsers: [],
        });

        await expect(service.deleteRole("cr_1")).rejects.toThrow(RoleNotFoundError);

        expect(prisma.customRole.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe("assignRoleToUser()", () => {
    describe("when target role is system_api_key kind", () => {
      it("throws RoleNotFoundError", async () => {
        prisma.customRole.findUnique.mockResolvedValueOnce({
          id: "cr_1", name: "apikey:ak_1", kind: "system_api_key",
          organizationId: "org_1", permissions: [],
        });

        await expect(
          service.assignRoleToUser("user_1", "team_1", "cr_1"),
        ).rejects.toThrow(RoleNotFoundError);
      });
    });
  });

  describe("createRole()", () => {
    describe("when name uses reserved apikey: prefix", () => {
      it("rejects before any persistence", async () => {
        await expect(
          service.createRole({
            organizationId: "org_1",
            name: "apikey:sneaky",
            permissions: ["traces:view"],
          }),
        ).rejects.toThrow(RoleReservedNameError);

        expect(prisma.customRole.create).not.toHaveBeenCalled();
      });
    });
  });
});

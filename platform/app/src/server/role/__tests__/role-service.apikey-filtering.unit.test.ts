import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleNotFoundError, RoleReservedNameError } from "../errors";
import { RoleService } from "../role.service";

// A role definition is a ledger command since ADR-092 delivery-plan PR 2.
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ledger,
}));

// No `create`/`update`/`delete` here on purpose: since ADR-092 PR 2 a role
// definition is a ledger command, so the service can no longer reach those
// Prisma methods at all. Asserting on them would assert nothing — the ledger
// writer above is where a refused write has to be observed.
function buildMockPrisma() {
  return {
    customRole: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    // Reads only, and all answering "nothing holds this role": without them a
    // delete that slipped past the kind guard would die on an undefined mock
    // rather than reaching the ledger, and the assertion below would pass for
    // the wrong reason.
    roleBinding: { count: vi.fn().mockResolvedValue(0) },
    teamUser: { count: vi.fn().mockResolvedValue(0) },
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
          id: "cr_1",
          name: "apikey:ak_1",
          kind: "system_api_key",
          permissions: [],
        });

        await expect(service.getRoleById("cr_1")).rejects.toThrow(
          RoleNotFoundError,
        );
      });
    });

    describe("when role is custom kind", () => {
      it("returns the role", async () => {
        prisma.customRole.findUnique.mockResolvedValue({
          id: "cr_1",
          name: "Engineer",
          kind: "custom",
          permissions: ["traces:view"],
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
          id: "cr_1",
          name: "apikey:ak_1",
          kind: "system_api_key",
          permissions: [],
        });

        await expect(
          service.updateRole({
            roleId: "cr_1",
            params: { name: "hijacked" },
            actor: { type: "user" as const, id: "actor_1" },
          }),
        ).rejects.toThrow(RoleNotFoundError);

        expect(ledger.defineRole).not.toHaveBeenCalled();
      });
    });

    describe("when renaming to reserved prefix", () => {
      it("throws RoleReservedNameError", async () => {
        await expect(
          service.updateRole({
            roleId: "cr_1",
            params: { name: "apikey:sneaky" },
            actor: { type: "user" as const, id: "actor_1" },
          }),
        ).rejects.toThrow(RoleReservedNameError);
      });
    });
  });

  describe("deleteRole()", () => {
    describe("when target role is system_api_key kind", () => {
      it("throws RoleNotFoundError", async () => {
        prisma.customRole.findUnique.mockResolvedValue({
          id: "cr_1",
          name: "apikey:ak_1",
          kind: "system_api_key",
          permissions: [],
          assignedUsers: [],
        });

        await expect(
          service.deleteRole({
            roleId: "cr_1",
            actor: { type: "user" as const, id: "actor_1" },
          }),
        ).rejects.toThrow(RoleNotFoundError);

        expect(ledger.deleteRole).not.toHaveBeenCalled();
      });
    });
  });

  describe("assignRoleToUser()", () => {
    describe("when target role is system_api_key kind", () => {
      it("throws RoleNotFoundError", async () => {
        prisma.customRole.findUnique.mockResolvedValueOnce({
          id: "cr_1",
          name: "apikey:ak_1",
          kind: "system_api_key",
          organizationId: "org_1",
          permissions: [],
        });

        await expect(
          service.assignRoleToUser({
            userId: "user_1",
            teamId: "team_1",
            customRoleId: "cr_1",
            actor: { type: "user" as const, id: "actor_1" },
          }),
        ).rejects.toThrow(RoleNotFoundError);
      });
    });
  });

  describe("createRole()", () => {
    describe("when name uses reserved apikey: prefix", () => {
      it("rejects before any persistence", async () => {
        await expect(
          service.createRole({
            params: {
              organizationId: "org_1",
              name: "apikey:sneaky",
              permissions: ["traces:view"],
            },
            actor: { type: "user", id: "actor_1" },
          }),
        ).rejects.toThrow(RoleReservedNameError);

        expect(ledger.defineRole).not.toHaveBeenCalled();
      });
    });
  });
});

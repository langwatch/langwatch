import { grantFactToRow } from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserNotTeamMemberError } from "../errors";
import { RoleService } from "../role.service";

// A team role assignment is a ledger command since ADR-092 delivery-plan PR 2.
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

const mockPrisma = {
  team: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    // The personal-team guard runs before the assignment; a shared team here.
    findFirst: vi.fn().mockResolvedValue(null),
  },
  grant: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  role: {
    findFirst: vi.fn(),
  },
  customRole: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  // `isRootPrismaClient` discriminates on `$connect` (Prisma 7 transaction
  // clients carry `$transaction` too), so a root-client stand-in must have it.
  $connect: vi.fn(),
} as any;

const teamMemberGrant = {
  ...grantFactToRow({
    organizationId: "org-1",
    grant: {
      grantId: "grant-team-1",
      principal: { type: "user", id: "user-rolebinding-only" },
      roleKey: "member",
      legacyRole: "MEMBER",
      scope: { type: "TEAM", id: "team-1" },
      source: "grants-service",
      occurredAtMs: 0,
    },
  }),
  updatedAt: new Date(0),
};

describe("RoleService.assignRoleToUser", () => {
  let service: RoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoleService(mockPrisma);
  });

  describe("when user has a team grant but no TeamUser row", () => {
    beforeEach(() => {
      mockPrisma.role.findFirst.mockResolvedValue({
        id: "role-1",
        organizationId: "org-1",
        kind: "custom",
        name: "Analyst",
        description: null,
        permissions: [],
        occurredAt: new Date(0),
        updatedAt: new Date(0),
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        organizationId: "org-1",
      });
      mockPrisma.grant.findMany.mockResolvedValue([teamMemberGrant]);
      mockPrisma.team.findUniqueOrThrow.mockResolvedValue({
        organizationId: "org-1",
      });
    });

    it("allows role assignment via the grant membership check", async () => {
      await expect(
        service.assignRoleToUser({
          userId: "user-rolebinding-only",
          teamId: "team-1",
          customRoleId: "role-1",
          actor: { type: "user" as const, id: "actor_1" },
        }),
      ).resolves.toEqual({ success: true });
    });

    it("queries grants with the user's team scope", async () => {
      await service.assignRoleToUser({
        userId: "user-rolebinding-only",
        teamId: "team-1",
        customRoleId: "role-1",
        actor: { type: "user" as const, id: "actor_1" },
      });

      expect(mockPrisma.grant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org-1",
            AND: expect.arrayContaining([
              expect.objectContaining({
                principalType: "USER",
                principalId: "user-rolebinding-only",
                scopeType: "TEAM",
                scopeId: "team-1",
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe("when user has no grant for the team", () => {
    beforeEach(() => {
      mockPrisma.role.findFirst.mockResolvedValue({
        id: "role-1",
        organizationId: "org-1",
        kind: "custom",
        name: "Analyst",
        description: null,
        permissions: [],
        occurredAt: new Date(0),
        updatedAt: new Date(0),
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        organizationId: "org-1",
      });
      mockPrisma.grant.findMany.mockResolvedValue([]);
    });

    it("throws UserNotTeamMemberError", async () => {
      await expect(
        service.assignRoleToUser({
          userId: "user-nobody",
          teamId: "team-1",
          customRoleId: "role-1",
          actor: { type: "user" as const, id: "actor_1" },
        }),
      ).rejects.toThrow(UserNotTeamMemberError);
    });
  });
});

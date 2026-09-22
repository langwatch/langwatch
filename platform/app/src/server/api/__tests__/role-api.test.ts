import { grantFactToRow } from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { RoleService } from "../../role";
import {
  RoleDuplicateNameError,
  RoleInUseError,
  RoleNotFoundError,
  TeamNotFoundError,
  UserNotTeamMemberError,
} from "../../role/errors";

// Role definitions and the grants that carry them are ledger commands since
// ADR-092 delivery-plan PR 2, so the writer is the seam these cases observe.
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

const teamGrant = {
  ...grantFactToRow({
    organizationId: "org-123",
    grant: {
      grantId: "grant-1",
      principal: { type: "user", id: "user-123" },
      roleKey: "member",
      scope: { type: "TEAM", id: "team-123" },
      source: "grants-service",
      occurredAtMs: 1,
    },
  }),
  updatedAt: new Date(1),
};

// Mock Prisma client
const mockPrisma = {
  grant: { findMany: vi.fn().mockResolvedValue([]) },
  role: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  team: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  teamUser: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  roleBinding: {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  organizationUser: {
    findFirst: vi.fn(),
  },
  // deleteIfUnused reads the cross-organization RoleBinding count in raw SQL
  // (the tenancy guard refuses the model client for that question).
  $queryRaw: vi.fn().mockResolvedValue([{ count: 0n }]),
  $transaction: vi
    .fn()
    .mockImplementation((fn: (tx: any) => Promise<any>) => fn(mockPrisma)),
  // `isRootPrismaClient` discriminates on `$connect` (Prisma 7 transaction
  // clients carry `$transaction` too), so a root-client stand-in must have it.
  $connect: vi.fn(),
} as any;

describe("RoleService Tests", () => {
  let roleService: RoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.grant.findMany.mockReset().mockResolvedValue([]);
    ledger.attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
    ledger.revokeBindings.mockResolvedValue(undefined);
    ledger.revokeBindingsWhere.mockResolvedValue(0);
    ledger.defineRole.mockResolvedValue(undefined);
    ledger.deleteRole.mockResolvedValue(undefined);
    roleService = new RoleService(mockPrisma);
  });

  const actor = { type: "user", id: "actor-1" } as const;

  describe("getAllRoles", () => {
    /** @scenario "Non-enterprise org can list custom roles" */
    it("returns all custom roles for organization", async () => {
      const mockRoles = [
        {
          id: "role-1",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
          organizationId: "org-123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "role-2",
          name: "Experiment Manager",
          description: "Can manage experiments",
          permissions: ["workflows:manage"],
          organizationId: "org-123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.role.findMany.mockResolvedValue(
        mockRoles.map(({ createdAt, ...role }) => ({
          ...role,
          kind: "custom",
          occurredAt: createdAt,
        })),
      );

      const result = await roleService.getAllRoles("org-123");

      expect(result).toEqual([
        {
          id: "role-1",
          kind: "custom",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
          organizationId: "org-123",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: "role-2",
          kind: "custom",
          name: "Experiment Manager",
          description: "Can manage experiments",
          permissions: ["workflows:manage"],
          organizationId: "org-123",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ]);
      expect(mockPrisma.role.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-123",
          kind: "custom",
          deletedAt: null,
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      });
    });
  });

  describe("getRoleById", () => {
    /** @scenario "Non-enterprise org can view a custom role" */
    it("returns role by ID", async () => {
      const mockRole = {
        id: "role-1",
        name: "Data Analyst",
        description: "Can view analytics and datasets",
        permissions: ["analytics:view", "datasets:view"],
        organizationId: "org-123",
        kind: "custom",
        occurredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.role.findFirst.mockResolvedValue(mockRole);

      const result = await roleService.getRoleById("role-1");

      expect(result).toEqual({
        id: mockRole.id,
        name: mockRole.name,
        description: mockRole.description,
        permissions: ["analytics:view", "datasets:view"],
        organizationId: mockRole.organizationId,
        kind: mockRole.kind,
        createdAt: mockRole.createdAt,
        updatedAt: mockRole.updatedAt,
      });
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(roleService.getRoleById("nonexistent-role")).rejects.toThrow(
        RoleNotFoundError,
      );
      await expect(
        roleService.getRoleById("nonexistent-role"),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });
    });
  });

  describe("createRole", () => {
    it("creates new custom role", async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      const result = await roleService.createRole({
        params: {
          organizationId: "org-123",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
        },
        actor,
      });

      // The answer IS the emitted fact: the row follows through the fold.
      expect(result).toMatchObject({
        organizationId: "org-123",
        name: "Data Analyst",
        description: "Can view analytics and datasets",
        permissions: ["analytics:view", "datasets:view"],
      });
      expect(ledger.defineRole).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
          kind: "custom",
        }),
      );
    });

    it("throws CONFLICT when role with same name exists", async () => {
      const existingRole = {
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.role.findFirst.mockResolvedValue(existingRole);

      await expect(
        roleService.createRole({
          params: {
            organizationId: "org-123",
            name: "Data Analyst",
            permissions: ["analytics:view"],
          },
          actor,
        }),
      ).rejects.toThrow(RoleDuplicateNameError);
      await expect(
        roleService.createRole({
          params: {
            organizationId: "org-123",
            name: "Data Analyst",
            permissions: ["analytics:view"],
          },
          actor,
        }),
      ).rejects.toThrow("A role with this name already exists");
    });
  });

  describe("updateRole", () => {
    it("updates custom role", async () => {
      const existingRole = {
        id: "role-1",
        name: "Data Analyst",
        description: "Old description",
        permissions: ["analytics:view"],
        organizationId: "org-123",
        kind: "custom",
        occurredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedRole = {
        ...existingRole,
        name: "Senior Data Analyst",
        description: "Updated description",
        permissions: ["analytics:view", "analytics:manage"],
      };

      mockPrisma.role.findFirst
        .mockResolvedValueOnce(existingRole)
        .mockResolvedValueOnce(existingRole)
        .mockResolvedValueOnce(null);

      const result = await roleService.updateRole({
        roleId: "role-1",
        params: {
          name: "Senior Data Analyst",
          description: "Updated description",
          permissions: ["analytics:view", "analytics:manage"],
        },
        actor,
      });

      expect(result).toMatchObject({
        name: updatedRole.name,
        description: updatedRole.description,
        permissions: ["analytics:view", "analytics:manage"],
      });
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        roleService.updateRole({
          roleId: "nonexistent-role",
          params: { name: "Updated Role" },
          actor,
        }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });
    });
  });

  describe("deleteRole", () => {
    it("deletes custom role when not assigned to users", async () => {
      const mockRoleWithUsers = {
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        kind: "custom",
        occurredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.role.findFirst.mockResolvedValue(mockRoleWithUsers);

      const result = await roleService.deleteRole({ roleId: "role-1", actor });

      expect(result).toEqual({ success: true });
      expect(ledger.deleteRole).toHaveBeenCalledWith(
        expect.objectContaining({ roleId: "role-1" }),
      );
    });

    it("refuses when a holder appeared after the service's own check", async () => {
      // The repository re-reads the holders immediately before it emits, so a
      // grant written in between stops the delete, and the refusal names what
      // holds the role now rather than reporting a success nobody performed.
      mockPrisma.role.findFirst.mockResolvedValue({
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        kind: "custom",
        occurredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // The role is re-read after nothing was emitted: still there means a
      // holder appeared, gone means somebody else deleted it.
      mockPrisma.role.findFirst.mockResolvedValue({
        id: "role-1",
        organizationId: "org-123",
        kind: "custom",
      });
      // The service's own check sees nothing; the repository's cross-org raw
      // read immediately before the append and the re-read that names what
      // holds the role now both find the grant. Per-call values, not
      // defaults: `clearAllMocks` between tests clears calls but keeps
      // implementations.
      mockPrisma.grant.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...teamGrant, roleKey: "custom:role-1" }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: 1n }]);

      await expect(
        roleService.deleteRole({ roleId: "role-1", actor }),
      ).rejects.toMatchObject({
        code: "custom_role_in_use",
      });
      expect(ledger.deleteRole).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        roleService.deleteRole({ roleId: "nonexistent-role", actor }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });
    });

    it("throws PRECONDITION_FAILED when role is assigned to users", async () => {
      const mockRoleWithUsers = {
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        kind: "custom",
        occurredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.role.findFirst.mockResolvedValue(mockRoleWithUsers);
      const userGrants = [
        {
          ...teamGrant,
          id: "grant-1",
          principalId: "user-1",
          roleKey: "custom:role-1",
        },
        {
          ...teamGrant,
          id: "grant-2",
          principalId: "user-2",
          roleKey: "custom:role-1",
        },
      ];
      mockPrisma.grant.findMany.mockImplementation(
        (args: { where?: { principalType?: unknown } }) =>
          Promise.resolve(
            args.where?.principalType === "USER" ? userGrants : [],
          ),
      );

      const deletion = roleService.deleteRole({ roleId: "role-1", actor });
      await expect(deletion).rejects.toThrow(RoleInUseError);
      await expect(deletion).rejects.toThrow(
        "Cannot delete role that is assigned to 2 user(s)",
      );
    });
  });

  describe("assignRoleToUser", () => {
    it("assigns custom role to user", async () => {
      const mockCustomRole = {
        id: "role-123",
        organizationId: "org-123",
        kind: "custom",
      };

      const mockTeam = {
        id: "team-123",
        organizationId: "org-123",
      };

      mockPrisma.role.findFirst.mockResolvedValue(mockCustomRole);
      mockPrisma.team.findUnique.mockResolvedValue(mockTeam);
      mockPrisma.team.findUniqueOrThrow.mockResolvedValue(mockTeam);
      mockPrisma.grant.findMany.mockResolvedValue([teamGrant]);
      mockPrisma.teamUser.update.mockResolvedValue({});

      const result = await roleService.assignRoleToUser({
        userId: "user-123",
        teamId: "team-123",
        customRoleId: "role-123",
        actor,
      });

      expect(result).toEqual({ success: true });
      expect(mockPrisma.grant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org-123",
            revokedAt: null,
            AND: expect.arrayContaining([
              expect.objectContaining({
                principalType: "USER",
                principalId: "user-123",
                scopeType: RoleBindingScopeType.TEAM,
                scopeId: "team-123",
              }),
            ]),
          }),
        }),
      );
      // Whatever they held on the team is revoked, then exactly the role the
      // caller named is attached - revoke first, so a crash between the two
      // leaves less access than asked for.
      expect(ledger.revokeBindingsWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-123",
            scopeType: "TEAM",
            scopeId: "team-123",
          }),
        }),
      );
      expect(ledger.revokeBindingsWhere).toHaveBeenCalledBefore(
        ledger.attachBindings,
      );
      expect(ledger.attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          bindings: [
            expect.objectContaining({
              principal: { userId: "user-123" },
              role: TeamUserRole.CUSTOM,
              customRoleId: "role-123",
            }),
          ],
        }),
      );
    });

    it("throws NOT_FOUND when custom role does not exist", async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        roleService.assignRoleToUser({
          userId: "user-123",
          teamId: "team-123",
          customRoleId: "nonexistent-role",
          actor,
        }),
      ).rejects.toThrow(RoleNotFoundError);
      await expect(
        roleService.assignRoleToUser({
          userId: "user-123",
          teamId: "team-123",
          customRoleId: "nonexistent-role",
          actor,
        }),
      ).rejects.toThrow("Custom role not found");
    });

    it("throws NOT_FOUND when team does not exist", async () => {
      const mockCustomRole = {
        id: "role-123",
        organizationId: "org-123",
        kind: "custom",
      };

      mockPrisma.role.findFirst.mockResolvedValue(mockCustomRole);
      mockPrisma.team.findUnique.mockResolvedValue(null);

      await expect(
        roleService.assignRoleToUser({
          userId: "user-123",
          teamId: "team-123",
          customRoleId: "role-123",
          actor,
        }),
      ).rejects.toThrow(TeamNotFoundError);
      await expect(
        roleService.assignRoleToUser({
          userId: "user-123",
          teamId: "team-123",
          customRoleId: "role-123",
          actor,
        }),
      ).rejects.toThrow("Team not found");
    });

    it("throws FORBIDDEN when user is not a team member", async () => {
      const mockCustomRole = {
        id: "role-123",
        organizationId: "org-123",
        kind: "custom",
      };

      const mockTeam = {
        id: "team-123",
        organizationId: "org-123",
      };

      mockPrisma.role.findFirst.mockResolvedValue(mockCustomRole);
      mockPrisma.team.findUnique.mockResolvedValue(mockTeam);
      mockPrisma.grant.findMany.mockResolvedValue([]);

      await expect(
        roleService.assignRoleToUser({
          userId: "user-123",
          teamId: "team-123",
          customRoleId: "role-123",
          actor,
        }),
      ).rejects.toThrow(UserNotTeamMemberError);
      expect(mockPrisma.grant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org-123",
            revokedAt: null,
            AND: expect.arrayContaining([
              expect.objectContaining({
                principalType: "USER",
                principalId: "user-123",
                scopeType: RoleBindingScopeType.TEAM,
                scopeId: "team-123",
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe("removeRoleFromUser", () => {
    it("removes custom role from user", async () => {
      mockPrisma.team.findUniqueOrThrow.mockResolvedValue({
        id: "team-123",
        organizationId: "org-123",
      });
      mockPrisma.teamUser.update.mockResolvedValue({});

      const result = await roleService.removeRoleFromUser({
        userId: "user-123",
        teamId: "team-123",
        actor,
      });

      expect(result).toEqual({ success: true });
      expect(ledger.revokeBindingsWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-123",
            scopeType: "TEAM",
            scopeId: "team-123",
          }),
        }),
      );
      expect(ledger.attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          bindings: [
            expect.objectContaining({
              principal: { userId: "user-123" },
              role: TeamUserRole.VIEWER,
            }),
          ],
        }),
      );
    });
  });
});

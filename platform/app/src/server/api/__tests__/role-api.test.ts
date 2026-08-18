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

// Mock Prisma client
const mockPrisma = {
  customRole: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
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

      mockPrisma.customRole.findMany.mockResolvedValue(mockRoles);

      const result = await roleService.getAllRoles("org-123");

      expect(result).toEqual([
        {
          id: "role-1",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
          organizationId: "org-123",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: "role-2",
          name: "Experiment Manager",
          description: "Can manage experiments",
          permissions: ["workflows:manage"],
          organizationId: "org-123",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ]);
      expect(mockPrisma.customRole.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-123",
          kind: "custom",
        },
        orderBy: { createdAt: "desc" },
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockRole);

      const result = await roleService.getRoleById("role-1");

      expect(result).toEqual({
        ...mockRole,
        permissions: ["analytics:view", "datasets:view"],
      });
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

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
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      const result = await roleService.createRole(
        {
          organizationId: "org-123",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
        },
        { actor },
      );

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

      mockPrisma.customRole.findUnique.mockResolvedValue(existingRole);

      await expect(
        roleService.createRole(
          {
            organizationId: "org-123",
            name: "Data Analyst",
            permissions: ["analytics:view"],
          },
          { actor },
        ),
      ).rejects.toThrow(RoleDuplicateNameError);
      await expect(
        roleService.createRole(
          {
            organizationId: "org-123",
            name: "Data Analyst",
            permissions: ["analytics:view"],
          },
          { actor },
        ),
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedRole = {
        ...existingRole,
        name: "Senior Data Analyst",
        description: "Updated description",
        permissions: ["analytics:view", "analytics:manage"],
      };

      mockPrisma.customRole.findUnique.mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) =>
          where.organizationId_name ? null : existingRole,
      );

      const result = await roleService.updateRole(
        "role-1",
        {
          name: "Senior Data Analyst",
          description: "Updated description",
          permissions: ["analytics:view", "analytics:manage"],
        },
        { actor },
      );

      expect(result).toMatchObject({
        name: updatedRole.name,
        description: updatedRole.description,
        permissions: ["analytics:view", "analytics:manage"],
      });
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      await expect(
        roleService.updateRole(
          "nonexistent-role",
          { name: "Updated Role" },
          { actor },
        ),
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
        createdAt: new Date(),
        updatedAt: new Date(),
        assignedUsers: [],
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockRoleWithUsers);
      mockPrisma.customRole.findFirst.mockResolvedValue(mockRoleWithUsers);

      const result = await roleService.deleteRole("role-1", { actor });

      expect(result).toEqual({ success: true });
      expect(ledger.deleteRole).toHaveBeenCalledWith(
        expect.objectContaining({ roleId: "role-1" }),
      );
    });

    it("refuses when a holder appeared after the service's own check", async () => {
      // The repository re-reads the holders immediately before it emits, so a
      // grant written in between stops the delete, and the refusal names what
      // holds the role now rather than reporting a success nobody performed.
      mockPrisma.customRole.findUnique.mockResolvedValue({
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        kind: "custom",
        createdAt: new Date(),
        updatedAt: new Date(),
        assignedUsers: [],
      });
      // The role is re-read after nothing was emitted: still there means a
      // holder appeared, gone means somebody else deleted it.
      mockPrisma.customRole.findFirst.mockResolvedValue({
        id: "role-1",
        organizationId: "org-123",
        kind: "custom",
      });
      // The service's own check sees nothing; the repository's cross-org raw
      // read immediately before the append and the re-read that names what
      // holds the role now both find the grant. Per-call values, not
      // defaults: `clearAllMocks` between tests clears calls but keeps
      // implementations.
      mockPrisma.roleBinding.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: 1n }]);

      await expect(
        roleService.deleteRole("role-1", { actor }),
      ).rejects.toMatchObject({
        code: "custom_role_in_use",
      });
      expect(ledger.deleteRole).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when role does not exist", async () => {
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      await expect(
        roleService.deleteRole("nonexistent-role", { actor }),
      ).rejects.toMatchObject({ code: "custom_role_not_found" });
    });

    it("throws PRECONDITION_FAILED when role is assigned to users", async () => {
      const mockRoleWithUsers = {
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        kind: "custom",
        createdAt: new Date(),
        updatedAt: new Date(),
        assignedUsers: [{ id: "user-1" }, { id: "user-2" }],
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockRoleWithUsers);

      await expect(roleService.deleteRole("role-1", { actor })).rejects.toThrow(
        RoleInUseError,
      );
      await expect(roleService.deleteRole("role-1", { actor })).rejects.toThrow(
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

      const mockBinding = {
        userId: "user-123",
        teamId: "team-123",
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockCustomRole);
      mockPrisma.team.findUnique.mockResolvedValue(mockTeam);
      mockPrisma.team.findUniqueOrThrow.mockResolvedValue(mockTeam);
      mockPrisma.roleBinding.findFirst.mockResolvedValue(mockBinding);
      mockPrisma.teamUser.update.mockResolvedValue({});

      const result = await roleService.assignRoleToUser({
        userId: "user-123",
        teamId: "team-123",
        customRoleId: "role-123",
        actor,
      });

      expect(result).toEqual({ success: true });
      expect(mockPrisma.roleBinding.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          organizationId: "org-123",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-123",
        },
      });
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
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

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

      mockPrisma.customRole.findUnique.mockResolvedValue(mockCustomRole);
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

      mockPrisma.customRole.findUnique.mockResolvedValue(mockCustomRole);
      mockPrisma.team.findUnique.mockResolvedValue(mockTeam);
      mockPrisma.roleBinding.findFirst.mockResolvedValue(null);

      await expect(
        roleService.assignRoleToUser({
          userId: "user-123",
          teamId: "team-123",
          customRoleId: "role-123",
          actor,
        }),
      ).rejects.toThrow(UserNotTeamMemberError);
      expect(mockPrisma.roleBinding.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          organizationId: "org-123",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-123",
        },
      });
    });
  });

  describe("removeRoleFromUser", () => {
    it("removes custom role from user", async () => {
      mockPrisma.team.findUniqueOrThrow.mockResolvedValue({
        id: "team-123",
        organizationId: "org-123",
      });
      mockPrisma.teamUser.update.mockResolvedValue({});

      const result = await roleService.removeRoleFromUser(
        "user-123",
        "team-123",
        { actor },
      );

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

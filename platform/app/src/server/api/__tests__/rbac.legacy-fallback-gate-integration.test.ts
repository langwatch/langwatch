/**
 * Stage B's per-organization switch at the legacy resolver seam
 * (specs/rbac/in-place-authz-migration.feature): once the in-place
 * migration FINALIZED an organization, the TeamUser fallback stops being
 * consulted; anywhere short of finalized keeps today's behaviour exactly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { resetLegacyFallbackGateForTesting } from "~/server/authz/legacy-fallback-gate";
import { type Permission, resolveTeamPermission } from "../rbac";

const mockPrisma = {
  team: { findUnique: vi.fn() },
  organizationUser: { findFirst: vi.fn() },
  teamUser: { findFirst: vi.fn(), findMany: vi.fn() },
  customRole: { findFirst: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  roleBinding: { findMany: vi.fn() },
  systemMigrationTenantState: { findUnique: vi.fn() },
} as any;

const mockSession = {
  user: { id: "user-123", email: "sam@example.com" },
} as any;

describe("legacy fallback per-organization gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLegacyFallbackGateForTesting();
    mockPrisma.team.findUnique.mockResolvedValue({
      id: "team-1",
      organizationId: "org-1",
    });
    mockPrisma.organizationUser.findFirst.mockResolvedValue({
      role: OrganizationUserRole.MEMBER,
    });
    mockPrisma.groupMembership.findMany.mockResolvedValue([]);
    // No bindings anywhere: the only source of access is the legacy row.
    mockPrisma.roleBinding.findMany.mockResolvedValue([]);
    mockPrisma.teamUser.findFirst.mockResolvedValue({
      userId: "user-123",
      teamId: "team-1",
      role: TeamUserRole.ADMIN,
      assignedRoleId: null,
    });
    mockPrisma.teamUser.findMany.mockResolvedValue([]);
  });

  describe("when the organization was finalized by the in-place migration", () => {
    /** @scenario "A finalized organization stops consulting the legacy fallback" */
    it("answers from bindings alone and never reads the legacy rows", async () => {
      mockPrisma.systemMigrationTenantState.findUnique.mockResolvedValue({
        status: "finalized",
      });

      const result = await resolveTeamPermission(
        { prisma: mockPrisma, session: mockSession },
        "team-1",
        "team:manage" as Permission,
      );

      expect(result.permitted).toBe(false);
      expect(mockPrisma.teamUser.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.teamUser.findMany).not.toHaveBeenCalled();
    });
  });

  describe.each(["pending", "migrated", "parked"] as const)(
    "when the organization is %s",
    (state) => {
      /** @scenario "An organization that is not finalized keeps today's behaviour exactly" */
      it("keeps the legacy fallback participating exactly as today", async () => {
        mockPrisma.systemMigrationTenantState.findUnique.mockResolvedValue(
          state === "pending" ? null : { status: state },
        );

        const result = await resolveTeamPermission(
          { prisma: mockPrisma, session: mockSession },
          "team-1",
          "team:manage" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(mockPrisma.teamUser.findFirst).toHaveBeenCalled();
      });
    },
  );

  describe("when the migration state table is unreadable", () => {
    it("fails safe with the fallback still on", async () => {
      mockPrisma.systemMigrationTenantState.findUnique.mockRejectedValue(
        new Error("relation does not exist"),
      );

      const result = await resolveTeamPermission(
        { prisma: mockPrisma, session: mockSession },
        "team-1",
        "team:manage" as Permission,
      );

      expect(result.permitted).toBe(true);
    });
  });
});

/**
 * The legacy TeamUser fallback at the resolver seam.
 *
 * An organization that has not finished its migration is answered by the
 * legacy walk, and the TeamUser rows are part of that walk for as long as it
 * is the one answering. Nothing switches them off per-organization: a
 * per-organization switch used to live here and did exactly that, which made
 * the legacy resolver disagree with the engine the moment an organization
 * finalized.
 *
 * A unit test, and named one: every Prisma delegate below is a stub, so it
 * opens no socket and needs no datastore.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { resetAuthzEngineGateForTesting } from "~/server/app-layer/authz/engine-gate";
import { type Permission, resolveTeamPermission } from "../rbac";

const mockPrisma = {
  team: { findUnique: vi.fn() },
  organizationUser: { findFirst: vi.fn() },
  teamUser: { findFirst: vi.fn(), findMany: vi.fn() },
  customRole: { findFirst: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  roleBinding: { findMany: vi.fn() },
  systemMigrationTenantState: { findUnique: vi.fn() },
  // The engine's own head, for the one case where the migration finished.
  grant: { findMany: vi.fn().mockResolvedValue([]) },
  role: { findMany: vi.fn().mockResolvedValue([]) },
} as any;

const mockSession = {
  user: { id: "user-123", email: "sam@example.com" },
} as any;

describe("legacy TeamUser fallback at the resolver seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A cold, explicit "not on the engine" answer: the gate cache is reset so
    // no other test's cached read leaks in, and the projection stub is what
    // keeps this suite on the legacy resolver path it exists to pin.
    resetAuthzEngineGateForTesting();
    mockPrisma.systemMigrationTenantState.findUnique.mockResolvedValue(null);
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

  describe.each([
    "pending",
    "parked",
  ] as const)("when the organization's migration is %s", (status) => {
    /** @scenario "An organization that has not finalized reads from legacy" */
    it("answers from the legacy row, whatever the migration is doing", async () => {
      mockPrisma.systemMigrationTenantState.findUnique.mockResolvedValue(
        status === "pending" ? null : { status },
      );

      const result = await resolveTeamPermission(
        { prisma: mockPrisma, session: mockSession },
        "team-1",
        "team:manage" as Permission,
      );

      expect(result.permitted).toBe(true);
      expect(mockPrisma.teamUser.findFirst).toHaveBeenCalled();
    });
  });

  describe("when the migration has finished", () => {
    // Finishing IS the switch (ADR-110), so the engine answers and the legacy
    // rows are not consulted at all. This is the half the old four-state
    // matrix could not express: it predated a world where any status moved the
    // organization off this path.
    /** @scenario "A cut-over organization is decided by the engine" */
    it("stops consulting the legacy row", async () => {
      mockPrisma.systemMigrationTenantState.findUnique.mockResolvedValue({
        status: "migrated",
      });

      await resolveTeamPermission(
        { prisma: mockPrisma, session: mockSession },
        "team-1",
        "team:manage" as Permission,
      );

      expect(mockPrisma.teamUser.findFirst).not.toHaveBeenCalled();
    });
  });
});

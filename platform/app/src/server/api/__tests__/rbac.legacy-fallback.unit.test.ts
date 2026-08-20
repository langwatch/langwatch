/**
 * The legacy TeamUser fallback at the resolver seam
 * (specs/rbac/in-place-authz-migration.feature): the fallback participates
 * for EVERY organization - pending, migrated, parked, or finalized - until
 * the contract change deletes the rows themselves. Stage B's finalization
 * proves the promoted bindings answer identically at the scopes they
 * replace; it does NOT switch the rows off. A per-organization switch used
 * to live here and did exactly that, which made the legacy resolver
 * disagree with the engine (whose readers keep inferring from the same
 * rows on both heads, the dormant-fact principle) the moment an
 * organization finalized.
 *
 * A unit test, and named one: every Prisma delegate below is a stub, so it
 * opens no socket and needs no datastore.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { resetAuthzEngineGateForTesting } from "~/server/app-layer/authz/cutover-gate";
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
    "migrated",
    "parked",
    "finalized",
  ] as const)("when the organization's backfill is %s", (state) => {
    /** @scenario "The legacy team rows keep answering until contract deletes them" */
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
      // No migration-state read stands between a permission check and the
      // rows: the fallback is unconditional until contract.
      expect(
        mockPrisma.systemMigrationTenantState.findUnique,
      ).not.toHaveBeenCalled();
    });
  });
});

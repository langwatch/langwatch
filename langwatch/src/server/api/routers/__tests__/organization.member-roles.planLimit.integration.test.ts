/**
 * @vitest-environment node
 *
 * Integration tests for organization.updateMemberRole plan limit enforcement.
 * Tests with real database — only mocks planProvider (system boundary).
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { createTestApp, resetApp } from "~/server/app-layer";
import { globalForApp } from "~/server/app-layer/app";
import {
  PlanProviderService,
  type PlanProvider,
} from "~/server/app-layer/subscription/plan-provider";
import { LICENSE_LIMIT_ERRORS } from "../../../license-enforcement/license-limit-guard";

// Skip when running with testcontainers only (no PostgreSQL)
const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "organization.updateMemberRole plan limit enforcement",
  () => {
    const testNamespace = `member-role-limit-${nanoid(8)}`;
    let organizationId: string;
    let adminUserId: string;
    let targetUserId: string;
    let teamId: string;
    let mockGetActivePlan: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      // Create organization
      const organization = await prisma.organization.create({
        data: {
          name: "Test Organization",
          slug: `--test-org-${testNamespace}`,
        },
      });
      organizationId = organization.id;

      // Create admin user (the caller)
      const adminUser = await prisma.user.create({
        data: {
          name: "Admin User",
          email: `admin-${testNamespace}@example.com`,
        },
      });
      adminUserId = adminUser.id;

      await prisma.organizationUser.create({
        data: {
          userId: adminUser.id,
          organizationId: organization.id,
          role: OrganizationUserRole.ADMIN,
        },
      });

      // Create a team + admin membership so RBAC passes
      const team = await prisma.team.create({
        data: {
          name: "Test Team",
          slug: `--test-team-${testNamespace}`,
          organizationId: organization.id,
        },
      });
      teamId = team.id;

      await prisma.teamUser.create({
        data: {
          userId: adminUser.id,
          teamId: team.id,
          role: TeamUserRole.ADMIN,
        },
      });

      // Create target user as MEMBER (full member)
      const targetUser = await prisma.user.create({
        data: {
          name: "Target User",
          email: `target-${testNamespace}@example.com`,
        },
      });
      targetUserId = targetUser.id;

      await prisma.organizationUser.create({
        data: {
          userId: targetUser.id,
          organizationId: organization.id,
          role: OrganizationUserRole.MEMBER,
        },
      });

      await prisma.teamUser.create({
        data: {
          userId: targetUser.id,
          teamId: team.id,
          role: TeamUserRole.MEMBER,
        },
      });
    });

    beforeEach(() => {
      resetApp();
      mockGetActivePlan = vi.fn();
      globalForApp.__langwatch_app = createTestApp({
        planProvider: PlanProviderService.create({
          getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
        }),
      });
    });

    afterEach(() => {
      resetApp();
    });

    afterAll(async () => {
      // Clean up in reverse creation order
      await prisma.teamUser
        .deleteMany({
          where: {
            team: { slug: `--test-team-${testNamespace}` },
          },
        })
        .catch(() => {});
      await prisma.team
        .deleteMany({
          where: { slug: `--test-team-${testNamespace}` },
        })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({
          where: { organizationId },
        })
        .catch(() => {});
      await prisma.organization
        .delete({ where: { id: organizationId } })
        .catch(() => {});
      await prisma.user
        .deleteMany({
          where: {
            email: { endsWith: `${testNamespace}@example.com` },
          },
        })
        .catch(() => {});

      resetApp();
    });

    function createCaller() {
      const ctx = createInnerTRPCContext({
        session: {
          user: { id: adminUserId },
          expires: "2099-01-01",
        },
        permissionChecked: true,
        publiclyShared: false,
      });
      return appRouter.createCaller(ctx);
    }

    describe("when demoting MEMBER to EXTERNAL (full-to-lite change)", () => {
      it("rejects when lite member limit reached", async () => {
        mockGetActivePlan.mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 0, // No lite members allowed
          overrideAddingLimitations: false,
        });

        const caller = createCaller();

        await expect(
          caller.organization.updateMemberRole({
            userId: targetUserId,
            organizationId,
            role: OrganizationUserRole.EXTERNAL,
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: LICENSE_LIMIT_ERRORS.MEMBER_LITE_LIMIT,
        });
      });

      it("allows when overrideAddingLimitations is true", async () => {
        mockGetActivePlan.mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 0, // No lite members allowed, but override active
          overrideAddingLimitations: true,
        });

        const caller = createCaller();

        // Should not throw — override bypasses the limit check
        await caller.organization.updateMemberRole({
          userId: targetUserId,
          organizationId,
          role: OrganizationUserRole.EXTERNAL,
        });

        // Verify the role was actually changed
        const updated = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: targetUserId,
              organizationId,
            },
          },
        });
        expect(updated?.role).toBe(OrganizationUserRole.EXTERNAL);

        // Reset target user back to MEMBER for subsequent tests
        await prisma.organizationUser.update({
          where: {
            userId_organizationId: {
              userId: targetUserId,
              organizationId,
            },
          },
          data: { role: OrganizationUserRole.MEMBER },
        });
      });
    });
  },
);

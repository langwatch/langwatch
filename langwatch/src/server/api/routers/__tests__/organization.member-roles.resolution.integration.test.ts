/**
 * @vitest-environment node
 *
 * ADR-039 Decision 5: role-change denials carry the plan's typed resolution
 * so seat-billed orgs are routed to the seat purchase flow instead of being
 * dead-ended. Real database; only the planProvider boundary is mocked.
 *
 * Deliberately NOT gated on TEST_CLICKHOUSE_URL (unlike the sibling
 * member-roles.planLimit file): this harness needs only PostgreSQL, which
 * the CI integration runner provides — the same pattern the invites
 * integration suite runs on every shard.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
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
import { createTestApp } from "~/server/app-layer/presets";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import {
  PlanProviderService,
  type PlanProvider,
} from "~/server/app-layer/subscription/plan-provider";

describe("organization member role denial resolution", () => {
  const testNamespace = `member-role-resolution-${nanoid(8)}`;
  let organizationId: string;
  let adminUserId: string;
  let targetUserId: string;
  let teamId: string;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `--test-org-${testNamespace}`,
      },
    });
    organizationId = organization.id;

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

    // Org-scoped ADMIN RoleBinding so checkOrganizationPermission passes
    await prisma.roleBinding.create({
      data: {
        id: `rb-role-res-${nanoid(8)}`,
        organizationId: organization.id,
        userId: adminUser.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organization.id,
      },
    });

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

  beforeEach(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create(
        {
          getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
        },
        { isSaaS: true },
      ),
    });
  });

  afterEach(async () => {
    await resetApp();
  });

  afterAll(async () => {
    await prisma.roleBinding
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.teamUser
      .deleteMany({ where: { team: { slug: `--test-team-${testNamespace}` } } })
      .catch(() => {});
    await prisma.team
      .deleteMany({ where: { slug: `--test-team-${testNamespace}` } })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.organization
      .delete({ where: { id: organizationId } })
      .catch(() => {});
    await prisma.user
      .deleteMany({
        where: { email: { endsWith: `${testNamespace}@example.com` } },
      })
      .catch(() => {});
    await resetApp();
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

  describe("when a seat-billed org at its cap changes a member's role", () => {
    /** @scenario Lite-to-full role change denial carries the resolution */
    it("carries resolution purchase_seat in the denial cause", async () => {
      mockGetActivePlan.mockResolvedValue({
        maxMembers: 100,
        maxMembersLite: 0,
        overrideAddingLimitations: false,
        billing: {
          meterUnit: "events",
          memberPolicy: "purchase_seat",
          showUsageLimits: false,
          isLegacyTiered: false,
        },
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
        cause: { resolution: "purchase_seat" },
      });
    });
  });
});

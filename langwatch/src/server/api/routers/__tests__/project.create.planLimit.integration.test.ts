/**
 * @vitest-environment node
 *
 * Integration tests for project.create plan limit enforcement.
 * Tests with real database — only mocks planProvider (system boundary).
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { OrganizationUserRole, RoleBindingScopeType, TeamUserRole } from "@prisma/client";
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
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";

// Skip when running with testcontainers only (no PostgreSQL)
// TEST_CLICKHOUSE_URL indicates testcontainers mode without full infrastructure
const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "project.create plan limit enforcement",
  () => {
    const testNamespace = `proj-limit-${nanoid(8)}`;
    let organizationId: string;
    let teamId: string;
    let userId: string;
    let mockGetActivePlan: ReturnType<typeof vi.fn>;
    let mockNotifyResourceLimitReached: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: {
          name: "Test Organization",
          slug: `--test-org-${testNamespace}`,
        },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: {
          name: "Test Team",
          slug: `--test-team-${testNamespace}`,
          organizationId: organization.id,
        },
      });
      teamId = team.id;

      const user = await prisma.user.create({
        data: {
          name: "Test User",
          email: `test-${testNamespace}@example.com`,
        },
      });
      userId = user.id;

      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrganizationUserRole.ADMIN,
        },
      });

      await prisma.teamUser.create({
        data: {
          userId: user.id,
          teamId: team.id,
          role: TeamUserRole.ADMIN,
        },
      });
    });

    beforeEach(() => {
      resetApp();
      mockGetActivePlan = vi.fn();
      mockNotifyResourceLimitReached = vi.fn().mockResolvedValue(undefined);
      globalForApp.__langwatch_app = createTestApp({
        planProvider: PlanProviderService.create({
          getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
        }),
        usageLimits: {
          notifyResourceLimitReached: mockNotifyResourceLimitReached,
          checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
        } as any,
      });
    });

    afterEach(() => {
      resetApp();
    });

    afterAll(async () => {
      await prisma.project
        .deleteMany({
          where: {
            team: { slug: `--test-team-${testNamespace}` },
          },
        })
        .catch(() => {});
      await prisma.teamUser
        .deleteMany({
          where: { team: { slug: `--test-team-${testNamespace}` } },
        })
        .catch(() => {});
      await prisma.team
        .deleteMany({
          where: { slug: `--test-team-${testNamespace}` },
        })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({
          where: { organization: { slug: `--test-org-${testNamespace}` } },
        })
        .catch(() => {});
      await prisma.organization
        .deleteMany({
          where: { slug: `--test-org-${testNamespace}` },
        })
        .catch(() => {});
      await prisma.user
        .deleteMany({
          where: { email: `test-${testNamespace}@example.com` },
        })
        .catch(() => {});
    });

    function createCaller() {
      const ctx = createInnerTRPCContext({
        session: {
          user: { id: userId },
          expires: "1",
        },
      });
      return appRouter.createCaller(ctx);
    }

    describe("when project count reaches maxProjects and overrideAddingLimitations is false", () => {
      it("rejects with FORBIDDEN", async () => {
        // Create projects up to the limit using real DB
        const projectsToCreate = 2;
        for (let i = 0; i < projectsToCreate; i++) {
          await prisma.project.create({
            data: {
              name: `Existing Project ${i}`,
              slug: `--test-proj-${testNamespace}-${i}`,
              apiKey: `sk-lw-test-${nanoid()}`,
              teamId,
              language: "en",
              framework: "test",
            },
          });
        }

        const plan: PlanInfo = {
          ...FREE_PLAN,
          maxProjects: projectsToCreate,
          overrideAddingLimitations: false,
        };
        mockGetActivePlan.mockResolvedValue(plan);

        const caller = createCaller();

        await expect(
          caller.project.create({
            organizationId,
            teamId,
            name: "One Too Many",
            language: "en",
            framework: "test",
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: "You have reached the maximum number of projects",
        });
      });

      it("sends a Slack notification to the ops team", async () => {
        const plan: PlanInfo = {
          ...FREE_PLAN,
          maxProjects: 0,
          overrideAddingLimitations: false,
        };
        mockGetActivePlan.mockResolvedValue(plan);

        const caller = createCaller();

        await expect(
          caller.project.create({
            organizationId,
            teamId,
            name: "Triggers Notification",
            language: "en",
            framework: "test",
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Wait for fire-and-forget notification promise to settle
        await vi.waitFor(() => {
          expect(mockNotifyResourceLimitReached).toHaveBeenCalledWith(
            expect.objectContaining({
              organizationId,
              limitType: "projects",
            }),
          );
        });
      });
    });

    describe("when overrideAddingLimitations is true", () => {
      it("allows project creation despite exceeding limit", async () => {
        const plan: PlanInfo = {
          ...FREE_PLAN,
          maxProjects: 1,
          overrideAddingLimitations: true,
        };
        mockGetActivePlan.mockResolvedValue(plan);

        const caller = createCaller();

        const result = await caller.project.create({
          organizationId,
          teamId,
          name: "Override Project",
          language: "en",
          framework: "test",
        });

        expect(result).toEqual({
          success: true,
          projectSlug: expect.any(String),
        });
      });
    });
  },
);

// Regression: BetterAuth uses RoleBinding for team membership — TeamUser is never populated.
// A user must be able to create a project with only a RoleBinding, no TeamUser row.
// Previously project.create checked teamUser.findFirst which always returned null, causing a 403.
describe.skipIf(isTestcontainersOnly)(
  "project.create with RoleBinding-only membership (no TeamUser)",
  () => {
    const testNamespace = `proj-rb-${nanoid(8)}`;
    let organizationId: string;
    let teamId: string;
    let userId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: {
          name: "RoleBinding Test Org",
          slug: `--test-org-rb-${testNamespace}`,
        },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: {
          name: "RoleBinding Test Team",
          slug: `--test-team-rb-${testNamespace}`,
          organizationId: organization.id,
        },
      });
      teamId = team.id;

      const user = await prisma.user.create({
        data: {
          name: "RoleBinding User",
          email: `rb-${testNamespace}@example.com`,
        },
      });
      userId = user.id;

      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrganizationUserRole.ADMIN,
        },
      });

      // Only RoleBinding — no TeamUser row, mimicking the BetterAuth membership model
      await prisma.roleBinding.create({
        data: {
          id: `rb-test-${nanoid(8)}`,
          organizationId: organization.id,
          userId: user.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      });
    });

    beforeEach(() => {
      resetApp();
      globalForApp.__langwatch_app = createTestApp({
        planProvider: PlanProviderService.create({
          getActivePlan: vi.fn().mockResolvedValue({
            ...FREE_PLAN,
            maxProjects: 10,
            overrideAddingLimitations: false,
          }) as PlanProvider["getActivePlan"],
        }),
        usageLimits: {
          notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
          checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
        } as any,
      });
    });

    afterEach(() => {
      resetApp();
    });

    afterAll(async () => {
      await prisma.project
        .deleteMany({ where: { teamId } })
        .catch(() => {});
      await prisma.roleBinding
        .deleteMany({ where: { organizationId, userId } })
        .catch(() => {});
      await prisma.team
        .deleteMany({ where: { slug: `--test-team-rb-${testNamespace}` } })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({ where: { organizationId, userId } })
        .catch(() => {});
      await prisma.organization
        .deleteMany({ where: { slug: `--test-org-rb-${testNamespace}` } })
        .catch(() => {});
      await prisma.user
        .deleteMany({ where: { email: `rb-${testNamespace}@example.com` } })
        .catch(() => {});
    });

    it("creates the project without a TeamUser row", async () => {
      const ctx = createInnerTRPCContext({
        session: { user: { id: userId }, expires: "1" },
      });
      const caller = appRouter.createCaller(ctx);

      const result = await caller.project.create({
        organizationId,
        teamId,
        name: "RoleBinding Project",
        language: "en",
        framework: "test",
      });

      expect(result).toEqual({
        success: true,
        projectSlug: expect.any(String),
      });
    });
  },
);

/**
 * @vitest-environment node
 *
 * Integration tests for project.create plan limit enforcement.
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

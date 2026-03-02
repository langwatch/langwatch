/**
 * @vitest-environment node
 *
 * Integration tests for team.createTeamWithMembers plan limit enforcement.
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
  "team.createTeamWithMembers plan limit enforcement",
  () => {
    const testNamespace = `team-limit-${nanoid(8)}`;
    let organizationId: string;
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

      // Create initial team + membership so RBAC passes
      const initialTeam = await prisma.team.create({
        data: {
          name: "Initial Team",
          slug: `--test-team-${testNamespace}-init`,
          organizationId: organization.id,
        },
      });

      await prisma.teamUser.create({
        data: {
          userId: user.id,
          teamId: initialTeam.id,
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
      await prisma.teamUser
        .deleteMany({
          where: {
            team: { slug: { startsWith: `--test-team-${testNamespace}` } },
          },
        })
        .catch(() => {});
      await prisma.team
        .deleteMany({
          where: { slug: { startsWith: `--test-team-${testNamespace}` } },
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

    describe("when team count reaches maxTeams and overrideAddingLimitations is false", () => {
      it("rejects with FORBIDDEN", async () => {
        // Create teams up to the limit using real DB
        const teamsToCreate = 2;
        for (let i = 0; i < teamsToCreate; i++) {
          await prisma.team.create({
            data: {
              name: `Existing Team ${i}`,
              slug: `--test-team-${testNamespace}-fill-${i}`,
              organizationId,
            },
          });
        }

        // Count includes the initial team from beforeAll, so total = teamsToCreate + 1
        const totalTeams = teamsToCreate + 1;
        const plan: PlanInfo = {
          ...FREE_PLAN,
          maxTeams: totalTeams,
          overrideAddingLimitations: false,
        };
        mockGetActivePlan.mockResolvedValue(plan);

        const caller = createCaller();

        await expect(
          caller.team.createTeamWithMembers({
            organizationId,
            name: "One Too Many",
            members: [{ userId, role: "ADMIN" }],
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: "Over the limit of teams allowed",
        });
      });
    });

    describe("when overrideAddingLimitations is true", () => {
      it("allows team creation despite exceeding limit", async () => {
        const plan: PlanInfo = {
          ...FREE_PLAN,
          maxTeams: 1,
          overrideAddingLimitations: true,
        };
        mockGetActivePlan.mockResolvedValue(plan);

        const caller = createCaller();

        const result = await caller.team.createTeamWithMembers({
          organizationId,
          name: "Override Team",
          members: [{ userId, role: "ADMIN" }],
        });

        expect(result).toBeDefined();
        expect(result.name).toBe("Override Team");
      });
    });
  },
);

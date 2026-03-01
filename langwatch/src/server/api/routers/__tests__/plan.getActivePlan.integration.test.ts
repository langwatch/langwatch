/**
 * @vitest-environment node
 *
 * Integration tests for plan.getActivePlan query.
 * Tests the actual query behavior with a real test database.
 * Only mocks: planProvider (system boundary — no real Stripe/license in test).
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

describe.skipIf(isTestcontainersOnly)("plan.getActivePlan integration", () => {
  const testNamespace = `plan-active-${nanoid(8)}`;
  let organizationId: string;
  let userId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;
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

    const team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `--test-team-${testNamespace}`,
        organizationId: organization.id,
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

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: userId },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterEach(() => {
    resetApp();
  });

  afterAll(async () => {
    await prisma.teamUser.deleteMany({
      where: { team: { slug: `--test-team-${testNamespace}` } },
    }).catch(() => {});
    await prisma.team.deleteMany({
      where: { slug: `--test-team-${testNamespace}` },
    }).catch(() => {});
    await prisma.organizationUser.deleteMany({
      where: { organization: { slug: `--test-org-${testNamespace}` } },
    }).catch(() => {});
    await prisma.organization.deleteMany({
      where: { slug: `--test-org-${testNamespace}` },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: `test-${testNamespace}@example.com` },
    }).catch(() => {});
  });

  describe("when organization has an active plan", () => {
    it("returns the plan from planProvider", async () => {
      const expectedPlan: PlanInfo = {
        ...FREE_PLAN,
        type: "PRO",
        name: "Pro",
        free: false,
        maxProjects: 10,
        maxMessagesPerMonth: 10_000,
      };
      mockGetActivePlan.mockResolvedValueOnce(expectedPlan);

      const result = await caller.plan.getActivePlan({
        organizationId,
      });

      expect(result).toEqual(expectedPlan);
    });

    it("passes organizationId and user to planProvider", async () => {
      mockGetActivePlan.mockResolvedValueOnce(FREE_PLAN);

      await caller.plan.getActivePlan({ organizationId });

      expect(mockGetActivePlan).toHaveBeenCalledWith({
        organizationId,
        user: { id: userId },
      });
    });
  });
});

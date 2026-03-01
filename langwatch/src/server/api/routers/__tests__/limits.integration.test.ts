/**
 * @vitest-environment node
 *
 * Integration tests for Limits tRPC endpoints.
 * Tests the router layer including message limit status calculation.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { OrganizationUserRole } from "@prisma/client";
import { createTestApp, resetApp } from "../../../app-layer";
import { globalForApp } from "../../../app-layer/app";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";

// Hoisted mocks for deterministic control (must use vi.hoisted to survive vi.mock hoisting)
const { mockGetCurrentMonthCount, mockGetActivePlan } = vi.hoisted(() => ({
  mockGetCurrentMonthCount: vi.fn(),
  mockGetActivePlan: vi.fn().mockResolvedValue({
    type: "PRO",
    name: "Pro",
    maxMessagesPerMonth: 1000,
  }),
}));


describe("Limits Router Integration", () => {
  const testOrgSlug = "limits-router-test-org";
  let organizationId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    // Wire App singleton so UsageStatsService.create() can call getApp().usage
    globalForApp.__langwatch_app = createTestApp({
      usage: { getCurrentMonthCount: mockGetCurrentMonthCount } as any,
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan,
      }),
    });

    const organization = await prisma.organization.upsert({
      where: { slug: testOrgSlug },
      update: {},
      create: {
        name: "Limits Router Test Org",
        slug: testOrgSlug,
      },
    });
    organizationId = organization.id;

    const user = await prisma.user.upsert({
      where: { email: "limits-router-test@test.com" },
      update: {},
      create: {
        email: "limits-router-test@test.com",
        name: "Limits Router Test User",
      },
    });

    await prisma.organizationUser.upsert({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId,
        },
      },
      update: { role: OrganizationUserRole.ADMIN },
      create: {
        userId: user.id,
        organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterEach(() => {
    resetApp();
  });

  afterAll(async () => {
    resetApp();
    await prisma.organizationUser.deleteMany({
      where: { organizationId },
    });
    await prisma.organization.deleteMany({
      where: { slug: testOrgSlug },
    });
    await prisma.user.deleteMany({
      where: { email: "limits-router-test@test.com" },
    });
  });

  describe("getUsage", () => {
    beforeEach(() => {
      mockGetCurrentMonthCount.mockReset();
      mockGetActivePlan.mockResolvedValue({
        type: "PRO",
        name: "Pro",
        maxMessagesPerMonth: 1000,
      });
      resetApp();
      globalForApp.__langwatch_app = createTestApp({
        usage: { getCurrentMonthCount: mockGetCurrentMonthCount } as any,
        planProvider: PlanProviderService.create({
          getActivePlan: mockGetActivePlan,
        }),
      });
    });

    describe("when usage is below 80% threshold", () => {
      it("returns messageLimitInfo with status ok", async () => {
        mockGetCurrentMonthCount.mockResolvedValue(500);

        const result = await caller.limits.getUsage({ organizationId });

        expect(result.messageLimitInfo.status).toBe("ok");
        expect(result.messageLimitInfo.current).toBe(500);
        expect(result.messageLimitInfo.max).toBe(1000);
      });
    });

    describe("when usage is between 80% and 100%", () => {
      it("returns messageLimitInfo with status warning and percentage", async () => {
        mockGetCurrentMonthCount.mockResolvedValue(850);

        const result = await caller.limits.getUsage({ organizationId });

        expect(result.messageLimitInfo.status).toBe("warning");
        expect(result.messageLimitInfo.percentageFormatted).toBe("85%");
        expect(result.messageLimitInfo.message).toMatch(/85%/);
      });
    });

    describe("when usage reaches or exceeds limit", () => {
      it("returns messageLimitInfo with status exceeded", async () => {
        mockGetCurrentMonthCount.mockResolvedValue(1000);

        const result = await caller.limits.getUsage({ organizationId });

        expect(result.messageLimitInfo.status).toBe("exceeded");
        expect(result.messageLimitInfo.message).toMatch(/reached the limit/);
      });

      it("keeps enforcement behavior when plan provider returns a copied FREE plan object", async () => {
        mockGetCurrentMonthCount.mockResolvedValue(1500);
        mockGetActivePlan.mockResolvedValue({
          type: "FREE",
          name: "Free",
          maxMessagesPerMonth: 1000,
        });

        const result = await caller.limits.getUsage({ organizationId });

        expect(result.messageLimitInfo.status).toBe("exceeded");
        expect(result.messageLimitInfo.max).toBe(1000);
      });
    });
  });
});

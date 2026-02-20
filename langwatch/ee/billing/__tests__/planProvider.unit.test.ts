import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_LIMITS } from "../planLimits";
import { PlanTypes, SubscriptionStatus } from "../planTypes";

vi.mock("../../../src/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    ADMIN_EMAILS: undefined,
  },
}));

vi.mock("../../../src/server/db", () => ({
  prisma: {},
}));

import { env } from "../../../src/env.mjs";
import { createSaaSPlanProvider } from "../planProvider";

const mockEnv = env as { IS_SAAS: boolean | undefined; ADMIN_EMAILS: string | undefined };

const createMockDb = (findFirstResult: unknown = null) => {
  return {
    subscription: {
      findFirst: vi.fn().mockResolvedValue(findFirstResult),
    },
  } as any;
};

describe("createSaaSPlanProvider", () => {
  beforeEach(() => {
    mockEnv.IS_SAAS = false;
    mockEnv.ADMIN_EMAILS = undefined;
  });

  describe("when IS_SAAS is false", () => {
    it("returns ENTERPRISE limits", async () => {
      mockEnv.IS_SAAS = false;

      const db = createMockDb();
      const provider = createSaaSPlanProvider(db);
      const plan = await provider.getActivePlan("org_1");

      expect(plan.type).toBe(PlanTypes.ENTERPRISE);
      expect(plan.maxMembers).toBe(PLAN_LIMITS[PlanTypes.ENTERPRISE].maxMembers);
    });
  });

  describe("when IS_SAAS is true", () => {
    beforeEach(() => {
      mockEnv.IS_SAAS = true;
    });

    describe("when no subscription exists", () => {
      it("returns FREE limits", async () => {
        const db = createMockDb(null);
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.maxMembers).toBe(PLAN_LIMITS[PlanTypes.FREE].maxMembers);
      });
    });

    describe("when active subscription exists", () => {
      it("returns plan limits with custom overrides", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          maxMembers: 10,
          maxProjects: null,
          maxMessagesPerMonth: null,
          evaluationsCredit: null,
        };

        const db = createMockDb(subscription);
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.LAUNCH);
        expect(plan.maxMembers).toBe(10);
        expect(plan.maxProjects).toBe(PLAN_LIMITS[PlanTypes.LAUNCH].maxProjects);
      });
    });

    describe("when customLimits fields are 0", () => {
      it("preserves 0 values instead of ignoring them", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          maxMembers: 0,
          maxProjects: 0,
          maxMessagesPerMonth: 0,
          evaluationsCredit: 0,
        };

        const db = createMockDb(subscription);
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.maxMembers).toBe(0);
        expect(plan.maxProjects).toBe(0);
        expect(plan.maxMessagesPerMonth).toBe(0);
        expect(plan.evaluationsCredit).toBe(0);
      });
    });

    describe("when plan key not in PLAN_LIMITS", () => {
      it("falls back to FREE", async () => {
        const subscription = {
          plan: "NONEXISTENT_PLAN",
          status: SubscriptionStatus.ACTIVE,
          maxMembers: null,
          maxProjects: null,
          maxMessagesPerMonth: null,
          evaluationsCredit: null,
        };

        const db = createMockDb(subscription);
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
      });
    });
  });

  describe("when impersonator is admin", () => {
    it("sets overrideAddingLimitations to true", async () => {
      mockEnv.IS_SAAS = false;
      mockEnv.ADMIN_EMAILS = "admin@example.com, other@example.com";

      const db = createMockDb();
      const provider = createSaaSPlanProvider(db);
      const plan = await provider.getActivePlan("org_1", {
        id: "user_1",
        email: "user@example.com",
        name: "User",
        impersonator: {
          email: "admin@example.com",
        },
      });

      expect(plan.overrideAddingLimitations).toBe(true);
    });

    it("trims whitespace in admin email list", async () => {
      mockEnv.IS_SAAS = false;
      mockEnv.ADMIN_EMAILS = "  admin@example.com , other@example.com  ";

      const db = createMockDb();
      const provider = createSaaSPlanProvider(db);
      const plan = await provider.getActivePlan("org_1", {
        id: "user_1",
        email: "user@example.com",
        name: "User",
        impersonator: {
          email: "admin@example.com",
        },
      });

      expect(plan.overrideAddingLimitations).toBe(true);
    });

    it("does not set overrideAddingLimitations when impersonator is not admin", async () => {
      mockEnv.IS_SAAS = false;
      mockEnv.ADMIN_EMAILS = "admin@example.com";

      const db = createMockDb();
      const provider = createSaaSPlanProvider(db);
      const plan = await provider.getActivePlan("org_1", {
        id: "user_1",
        email: "user@example.com",
        name: "User",
        impersonator: {
          email: "notadmin@example.com",
        },
      });

      expect(plan.overrideAddingLimitations).toBe(false);
    });
  });
});

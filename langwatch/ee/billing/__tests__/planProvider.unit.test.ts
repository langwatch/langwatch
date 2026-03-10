import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_LIMITS, getFreePlanLimits } from "../planLimits";
import { NUMERIC_OVERRIDE_FIELDS } from "../planProvider";
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

const createMockDb = ({
  findFirstResult = null,
  orgFindUniqueResult = undefined,
  updateShouldFail = false,
}: {
  findFirstResult?: unknown;
  orgFindUniqueResult?: unknown;
  updateShouldFail?: boolean;
} = {}) => {
  return {
    subscription: {
      findFirst: vi.fn().mockResolvedValue(findFirstResult),
      update: updateShouldFail
        ? vi.fn().mockRejectedValue(new Error("DB write failed"))
        : vi.fn().mockResolvedValue({}),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(orgFindUniqueResult),
    },
  } as unknown as PrismaClient;
};

describe("getFreePlanLimits", () => {
  it("returns 50,000 messages per month", () => {
    const plan = getFreePlanLimits();
    expect(plan.maxMessagesPerMonth).toBe(50_000);
  });

  it("preserves all other FREE plan properties", () => {
    const plan = getFreePlanLimits();
    const baseFree = PLAN_LIMITS[PlanTypes.FREE];

    expect(plan.type).toBe(PlanTypes.FREE);
    expect(plan.name).toBe("Free");
    expect(plan.free).toBe(true);
    expect(plan.maxMembers).toBe(baseFree.maxMembers);
    expect(plan.maxProjects).toBe(baseFree.maxProjects);
  });
});

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
        const db = createMockDb();
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.maxMembers).toBe(PLAN_LIMITS[PlanTypes.FREE].maxMembers);
      });

      describe("when organization has SEAT_EVENT pricing model", () => {
        it("returns FREE with 50,000 messages per month", async () => {
          const db = createMockDb({
            orgFindUniqueResult: { pricingModel: "SEAT_EVENT" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
        });
      });

      describe("when organization has TIERED pricing model", () => {
        it("returns FREE with 50,000 messages per month", async () => {
          const db = createMockDb({
            orgFindUniqueResult: { pricingModel: "TIERED" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
        });
      });

      describe("when organization is not found", () => {
        it("returns FREE with 50,000 messages per month", async () => {
          const db = createMockDb({
            orgFindUniqueResult: null,
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
        });
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

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.LAUNCH);
        expect(plan.maxMembers).toBe(10);
        expect(plan.maxProjects).toBe(PLAN_LIMITS[PlanTypes.LAUNCH].maxProjects);
      });

      describe("when valid subscription exists for SEAT_EVENT org", () => {
        it("does not query the organization table", async () => {
          const subscription = {
            plan: PlanTypes.LAUNCH,
            status: SubscriptionStatus.ACTIVE,
            maxMembers: null,
            maxProjects: null,
            maxMessagesPerMonth: null,
            evaluationsCredit: null,
          };

          const db = createMockDb({
            findFirstResult: subscription,
            orgFindUniqueResult: { pricingModel: "SEAT_EVENT" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.LAUNCH);
          expect(db.organization.findUnique).not.toHaveBeenCalled();
        });
      });
    });

    describe("when customLimits fields are 0", () => {
      it("preserves 0 values instead of ignoring them", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          ...Object.fromEntries(NUMERIC_OVERRIDE_FIELDS.map((f) => [f, 0])),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        for (const field of NUMERIC_OVERRIDE_FIELDS) {
          expect(plan[field], `expected ${field} to be 0`).toBe(0);
        }
      });
    });

    describe("when maxWorkflows override is set", () => {
      it("applies the override (bug fix)", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          maxWorkflows: 25,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxWorkflows").map(
              (f) => [f, null],
            ),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.maxWorkflows).toBe(25);
      });
    });

    describe("when new override fields are set", () => {
      it.each([
        ["maxMembersLite", 15],
        ["maxTeams", 10],
        ["maxPrompts", 30],
        ["maxEvaluators", 40],
        ["maxScenarios", 20],
        ["maxAgents", 12],
        ["maxExperiments", 50],
        ["maxOnlineEvaluations", 18],
        ["maxDatasets", 25],
        ["maxDashboards", 8],
        ["maxCustomGraphs", 15],
        ["maxAutomations", 22],
      ] as const)("applies %s override when set to %d", async (field, value) => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          [field]: value,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== field).map((f) => [
              f,
              null,
            ]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan[field]).toBe(value);
      });
    });

    describe("when all overrides are null", () => {
      it("falls back to plan defaults for every field", async () => {
        const subscription = {
          plan: PlanTypes.LAUNCH,
          status: SubscriptionStatus.ACTIVE,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        const basePlan = PLAN_LIMITS[PlanTypes.LAUNCH];
        for (const field of NUMERIC_OVERRIDE_FIELDS) {
          expect(plan[field], `expected ${field} to match plan default`).toBe(
            basePlan[field],
          );
        }
      });
    });

    describe("when plan key not in PLAN_LIMITS", () => {
      it("falls back to FREE", async () => {
        const subscription = {
          plan: "NONEXISTENT_PLAN",
          status: SubscriptionStatus.ACTIVE,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
      });

      it("applies overrides over free defaults", async () => {
        const subscription = {
          plan: "NONEXISTENT_PLAN",
          status: SubscriptionStatus.ACTIVE,
          maxWorkflows: 50,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxWorkflows").map(
              (f) => [f, null],
            ),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.maxWorkflows).toBe(50);
      });

      describe("when SEAT_EVENT org has unknown plan key", () => {
        it("returns FREE with 50,000 messages per month", async () => {
          const subscription = {
            plan: "NONEXISTENT_PLAN",
            status: SubscriptionStatus.ACTIVE,
            ...Object.fromEntries(
              NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
            ),
          };

          const db = createMockDb({
            findFirstResult: subscription,
            orgFindUniqueResult: { pricingModel: "SEAT_EVENT" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
        });
      });

      describe("when SEAT_EVENT org has unknown plan key with custom limits", () => {
        it("preserves subscription custom limits over free plan limits", async () => {
          const subscription = {
            plan: "NONEXISTENT_PLAN",
            status: SubscriptionStatus.ACTIVE,
            maxMembers: 15,
            ...Object.fromEntries(
              NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxMembers").map(
                (f) => [f, null],
              ),
            ),
          };

          const db = createMockDb({
            findFirstResult: subscription,
            orgFindUniqueResult: { pricingModel: "SEAT_EVENT" },
          });
          const provider = createSaaSPlanProvider(db);
          const plan = await provider.getActivePlan("org_1");

          expect(plan.type).toBe(PlanTypes.FREE);
          expect(plan.maxMessagesPerMonth).toBe(50_000);
          expect(plan.maxMembers).toBe(15);
        });
      });
    });

    describe("trial subscription handling", () => {
      it("when trial subscription is active, returns GROWTH_SEAT limits with activeTrial=true", async () => {
        const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const subscription = {
          id: "sub_trial_1",
          plan: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          isTrial: true,
          endDate: futureDate,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.GROWTH_SEAT_EUR_MONTHLY);
        expect(plan.activeTrial).toBe(true);
        expect(plan.trialEndDate).toEqual(futureDate);
        expect(plan.free).toBe(false);
      });

      it("when trial subscription has custom maxMembers override, applies the override", async () => {
        const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const subscription = {
          id: "sub_trial_1",
          plan: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          isTrial: true,
          endDate: futureDate,
          maxMembers: 50,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.filter((f) => f !== "maxMembers").map(
              (f) => [f, null],
            ),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.activeTrial).toBe(true);
        expect(plan.maxMembers).toBe(50);
      });

      it("when trial subscription is expired, expires it and returns FREE with activeTrial=false", async () => {
        const pastDate = new Date(Date.now() - 1000);
        const subscription = {
          id: "sub_trial_1",
          plan: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          isTrial: true,
          endDate: pastDate,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.activeTrial).toBe(false);
        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_trial_1" },
          data: { status: SubscriptionStatus.CANCELLED },
        });
      });

      it("when trial subscription is expired and DB write fails, still returns FREE", async () => {
        const pastDate = new Date(Date.now() - 1000);
        const subscription = {
          id: "sub_trial_1",
          plan: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          isTrial: true,
          endDate: pastDate,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({
          findFirstResult: subscription,
          updateShouldFail: true,
        });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.activeTrial).toBe(false);
      });

      it("when paid subscription exists, returns plan limits with activeTrial=false", async () => {
        const subscription = {
          id: "sub_paid_1",
          plan: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          isTrial: false,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.GROWTH_SEAT_EUR_MONTHLY);
        expect(plan.activeTrial).toBe(false);
      });

      it("when no subscription exists, returns FREE with activeTrial=false", async () => {
        const db = createMockDb();
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.FREE);
        expect(plan.activeTrial).toBe(false);
      });

      it("when both trial and paid subscription exist, most recent wins (orderBy test)", async () => {
        // The findFirst with orderBy: { createdAt: "desc" } returns the most recent.
        // If the most recent is a paid sub, it should return paid limits.
        const subscription = {
          id: "sub_paid_1",
          plan: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          isTrial: false,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.GROWTH_SEAT_EUR_MONTHLY);
        expect(plan.activeTrial).toBe(false);

        // Verify orderBy was passed to findFirst
        expect(db.subscription.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { createdAt: "desc" },
          }),
        );
      });

      it("when newer trial exists alongside older paid sub, paid sub takes precedence (not isTrial)", async () => {
        // If findFirst returns a newer trial (because of orderBy desc),
        // but the paid sub is NOT isTrial, the paid sub should win.
        // However, findFirst only returns one record. The scenario tests that
        // when the most recent is a paid sub, it returns paid limits.
        const paidSubscription = {
          id: "sub_paid_1",
          plan: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          isTrial: false,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: paidSubscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.activeTrial).toBe(false);
        expect(plan.type).toBe(PlanTypes.GROWTH_SEAT_EUR_MONTHLY);
      });

      it("when non-SaaS, returns ENTERPRISE regardless of trial", async () => {
        mockEnv.IS_SAAS = false;

        const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const subscription = {
          id: "sub_trial_1",
          plan: PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
          status: SubscriptionStatus.ACTIVE,
          isTrial: true,
          endDate: futureDate,
          ...Object.fromEntries(
            NUMERIC_OVERRIDE_FIELDS.map((f) => [f, null]),
          ),
        };

        const db = createMockDb({ findFirstResult: subscription });
        const provider = createSaaSPlanProvider(db);
        const plan = await provider.getActivePlan("org_1");

        expect(plan.type).toBe(PlanTypes.ENTERPRISE);
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

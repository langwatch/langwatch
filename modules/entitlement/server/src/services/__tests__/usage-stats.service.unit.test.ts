/**
 * The month's usage reading, as every usage surface receives it.
 *
 * Spec: ../../../../specs/usage-stats-reporting.feature
 */
import { usageStatsSchema, type Plan, type PlanProvider } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";
import { UsageCounter, type UsageCount } from "../../app/entitlement.infrastructure.ts";
import type { UsageMembershipRepository } from "../../repositories/usage-membership.repository.ts";
import { UNCAPPED_MONTHLY_USAGE_LIMIT, UsageStatsService } from "../usage-stats.service.ts";

const UNLIMITED_MESSAGES = 999_999_999;

function planWith(maxMessagesPerMonth: number): Plan {
  return {
    planSource: "free",
    type: "FREE",
    name: "Free",
    free: true,
    maxMembers: 5,
    maxMembersLite: 5,
    maxMessagesPerMonth,
    canPublish: false,
    prices: { USD: 0, EUR: 0 },
  };
}

class StubMembership implements UsageMembershipRepository {
  async getMemberCount(): Promise<number> {
    return 3;
  }
  async getMembersLiteCount(): Promise<number> {
    return 1;
  }
  async getCurrentMonthCost(): Promise<number> {
    return 12.5;
  }
  async getCurrentMonthCostForProjects(): Promise<number> {
    return 12.5;
  }
}

class StubCounter implements UsageCounter {
  constructor(private readonly count: UsageCount) {
  }
  async getCurrentMonthCountForDisplay(): Promise<UsageCount> {
    return this.count;
  }
  async getResolvedUsageUnit(): Promise<"traces" | "events"> {
    return "traces";
  }
}

function serviceOn(plan: Plan, count: UsageCount = 4_200): UsageStatsService {
  const plans: PlanProvider = { getActivePlan: async () => plan };
  return UsageStatsService.create({
    membership: new StubMembership(),
    counter: new StubCounter(count),
    plans,
  });
}

describe("UsageStatsService", () => {
  describe("given a plan with no monthly usage cap", () => {
    /** @scenario An uncapped plan reports a finite allowance */
    it("reports a finite allowance the published contract accepts", async () => {
      const stats = await serviceOn(planWith(UNLIMITED_MESSAGES)).getUsageStats("org-1", {
        id: "user-1",
      });

      // Infinity is neither JSON nor a `z.number()`: shipping it made the read a 500.
      expect(Number.isFinite(stats.maxMonthlyUsageLimit)).toBe(true);
      expect(stats.maxMonthlyUsageLimit).toBe(UNCAPPED_MONTHLY_USAGE_LIMIT);
      expect(() => usageStatsSchema.parse(stats)).not.toThrow();
    });

    it("says the allowance is unlimited rather than quoting a number", async () => {
      const stats = await serviceOn(planWith(UNLIMITED_MESSAGES)).getUsageStats("org-1", {
        id: "user-1",
      });

      expect(stats.messageLimitInfo.maxFormatted).toBe("Unlimited");
      expect(stats.messageLimitInfo.status).toBe("ok");
    });
  });

  describe("given a plan with a monthly message allowance", () => {
    /** @scenario A capped plan reports the allowance it was given */
    it("quotes that allowance and stays inside the published contract", async () => {
      const stats = await serviceOn(planWith(10_000), 9_000).getUsageStats("org-1", {
        id: "user-1",
      });

      expect(stats.messageLimitInfo.max).toBe(10_000);
      expect(stats.messageLimitInfo.status).toBe("warning");
      expect(() => usageStatsSchema.parse(stats)).not.toThrow();
    });
  });
});

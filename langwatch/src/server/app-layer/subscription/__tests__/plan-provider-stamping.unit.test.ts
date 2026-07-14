import { describe, expect, it, vi } from "vitest";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { PlanProviderService } from "../plan-provider";

const seatSubscriptionPlan = {
  ...FREE_PLAN,
  type: "GROWTH_SEAT_USD_MONTHLY",
  name: "Growth",
  free: false,
  planSource: "subscription" as const,
};

const enterpriseLicensePlan = {
  ...FREE_PLAN,
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  planSource: "license" as const,
};

function providerReturning(plan: unknown) {
  return { getActivePlan: vi.fn().mockResolvedValue(plan) };
}

describe("PlanProviderService", () => {
  describe("when resolving any plan", () => {
    it("stamps the billing profile derived from the winning source", async () => {
      const service = PlanProviderService.create(
        providerReturning(seatSubscriptionPlan),
        { isSaaS: true },
      );

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan.billing).toEqual({
        meterUnit: "events",
        memberPolicy: "purchase_seat",
        showUsageLimits: false,
        isLegacyTiered: false,
      });
    });

    it("stamps capabilities derived from the winning plan", async () => {
      const service = PlanProviderService.create(
        providerReturning(enterpriseLicensePlan),
        { isSaaS: true },
      );

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan.capabilities?.sso).toBe(true);
    });

    it("preserves every field of the inner plan", async () => {
      const service = PlanProviderService.create(
        providerReturning(seatSubscriptionPlan),
        { isSaaS: true },
      );

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan).toMatchObject(seatSubscriptionPlan);
    });
  });

  describe("when running self-hosted", () => {
    /** @scenario Self-hosted resolution behavior is unchanged */
    it("returns the license plan's own fields unchanged", async () => {
      const service = PlanProviderService.create(
        providerReturning(enterpriseLicensePlan),
        { isSaaS: false },
      );

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan).toMatchObject(enterpriseLicensePlan);
    });

    it("derives the billing profile with self-hosted member policy", async () => {
      const service = PlanProviderService.create(
        providerReturning({
          ...FREE_PLAN,
          type: "GROWTH",
          free: false,
          planSource: "license" as const,
        }),
        { isSaaS: false },
      );

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan.billing?.memberPolicy).toBe("hard_cap");
    });
  });
});

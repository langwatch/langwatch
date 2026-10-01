import { createApiFixture } from "@langwatch/api-fixture";
import type { EntitlementApi, Plan, PlanNextStep } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import {
  AutomationNextStepService,
  AutomationOrganizationPricing,
} from "../automation-next-step.service.ts";

const pro: Plan = {
  planSource: "subscription",
  type: "PRO",
  name: "Pro",
  free: false,
  maxMembers: 5,
  maxMembersLite: 5,
  maxMessagesPerMonth: 10_000,
  canPublish: true,
  prices: { USD: 99, EUR: 99 },
};

const launch: PlanNextStep = {
  kind: "self_serve",
  tier: "LAUNCH",
  name: "Launch",
  monthlyPrice: 59,
  currency: "EUR",
  pricedPerSeat: false,
  maxMessagesPerMonth: 20_000,
  maxMembers: 3,
  automationDailyDispatchCeiling: 150,
};

class TieredEuroPricing extends AutomationOrganizationPricing {
  pricingFor() {
    return Promise.resolve({
      kind: "priced" as const,
      pricingModel: "TIERED" as const,
      currency: "EUR" as const,
    });
  }
}

describe("AutomationNextStepService", () => {
  /** @scenario "A ceiling notice quotes the rung entitlement names next" */
  it("links the checkout of the rung the entitlement capability names", async () => {
    const asked: Parameters<EntitlementApi["resolvePlanNextStep"]>[0][] = [];
    const entitlement = createApiFixture<EntitlementApi>({
      getActivePlan: () => Promise.resolve(pro),
      resolvePlanNextStep: (input) => {
        asked.push(input);
        return Promise.resolve(launch);
      },
    });
    const adapter = AutomationNextStepService.create({
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: () => Promise.resolve("organization-1"),
      }),
      plans: entitlement,
      organizations: new TieredEuroPricing(),
      nextStep: entitlement,
      baseHost: "https://app.example.com",
    });

    const step = await adapter.resolve("project-1");

    expect(asked).toEqual([{ plan: pro, pricingModel: "TIERED", currency: "EUR" }]);
    expect(step).toEqual({
      kind: "named",
      nextStep: {
        kind: "self_serve",
        name: "Launch",
        url: "https://app.example.com/settings/subscription/checkout/launch",
        price: 59,
        currency: "EUR",
        billingPeriod: "monthly",
        pricedPerSeat: false,
        dailyCeiling: 150,
      },
    });
  });
});

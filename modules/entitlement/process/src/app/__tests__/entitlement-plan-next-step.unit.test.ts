import type { Plan } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import { createEntitlementTestApp, fixedEntitlementSource } from "./entitlement.fixture.ts";

const free: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 5,
  maxMembersLite: 5,
  maxMessagesPerMonth: 1_000,
  canPublish: false,
  prices: { USD: 0, EUR: 0 },
};

describe("EntitlementApp.resolvePlanNextStep", () => {
  /** @scenario "A peer asks the entitlement capability for the next step" */
  it("names the rung the self-serve catalogue sells above a paid tiered plan", async () => {
    const app = createEntitlementTestApp({
      members: { baseline: free, license: fixedEntitlementSource(null) },
    });

    const pro: Plan = {
      ...free,
      planSource: "subscription",
      type: "PRO",
      name: "Pro",
      free: false,
    };

    const step = await app.resolvePlanNextStep({ plan: pro, pricingModel: "TIERED" });

    expect(step).toEqual({
      kind: "self_serve",
      tier: "LAUNCH",
      name: "Launch",
      monthlyPrice: 59,
      currency: "USD",
      pricedPerSeat: false,
      maxMessagesPerMonth: 20_000,
      maxMembers: 3,
      automationDailyDispatchCeiling: 150,
    });
  });
});

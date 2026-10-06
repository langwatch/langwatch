import type { Plan } from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

function pricedOrganizations(pricing: Awaited<ReturnType<OrganizationApi["getPricing"]>>) {
  const asked: string[] = [];
  const organizations = createApiFixture<OrganizationApi>({
    getPricing: async ({ organizationId }) => {
      asked.push(organizationId);
      return pricing;
    },
  });

  return Object.assign(organizations, { asked });
}

describe("EntitlementModule.resolvePlanNextStep", () => {
  /** @scenario "A peer asks the entitlement capability for the next step" */
  it("names the rung the self-serve catalogue sells above a paid tiered plan", async () => {
    const app = createEntitlementTestApp({
      infrastructure: { baseline: free, license: fixedEntitlementSource(null) },
      dependencies: {
        organizations: pricedOrganizations({ pricingModel: "TIERED", currency: "USD" }),
      },
    });

    const pro: Plan = {
      ...free,
      planSource: "subscription",
      type: "PRO",
      name: "Pro",
      free: false,
    };

    const step = await app.resolvePlanNextStep({ plan: pro, organizationId: "organization-1" });

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

  /** @scenario "A peer asks for the next step without knowing the organization's pricing" */
  it("quotes the rung in the currency the organization's own pricing names", async () => {
    const organizations = pricedOrganizations({ pricingModel: "TIERED", currency: "EUR" });
    const app = createEntitlementTestApp({
      infrastructure: { baseline: free, license: fixedEntitlementSource(null) },
      dependencies: { organizations },
    });
    const pro: Plan = {
      ...free,
      planSource: "subscription",
      type: "PRO",
      name: "Pro",
      free: false,
    };

    const step = await app.resolvePlanNextStep({ plan: pro, organizationId: "organization-1" });

    expect(organizations.asked).toEqual(["organization-1"]);
    expect(step).toMatchObject({ kind: "self_serve", tier: "LAUNCH", currency: "EUR" });
  });
});

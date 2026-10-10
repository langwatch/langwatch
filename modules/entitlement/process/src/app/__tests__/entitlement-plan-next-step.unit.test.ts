import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { Plan } from "@langwatch/entitlement-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryEntitlementDatabase } from "../../repositories/memory/memory.entitlement.database.ts";
import { MemoryEntitlementRepositories } from "../../repositories/memory/memory.entitlement.repositories.ts";
import { MemoryTenancyRepository } from "../../repositories/memory/memory.tenancy.repository.ts";
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

/** An app whose organisation is priced in a currency on its own row and a model billing answers. */
function pricedApp(pricing: { pricingModel: "TIERED" | "SEAT_EVENT"; currency: "USD" | "EUR" }) {
  const asked: string[] = [];
  const database = MemoryEntitlementDatabase.create();
  database.put({
    organizationId: "organization-1",
    memberCount: 0,
    membersLiteCount: 0,
    currentMonthCost: 0,
    projectCosts: {},
    spendByUserId: {},
    currency: pricing.currency,
  });
  const app = createEntitlementTestApp({
    infrastructure: { baseline: free, license: fixedEntitlementSource(null) },
    repositories: {
      ...MemoryEntitlementRepositories.create(),
      tenancy: MemoryTenancyRepository.create({ memory: database }),
    },
    dependencies: {
      billing: createApiFixture<BillingApi>({
        getPricingModel: async ({ organizationId }) => {
          asked.push(organizationId);
          return { pricingModel: pricing.pricingModel };
        },
      }),
    },
  });

  return { app, asked };
}

describe("EntitlementModule.resolvePlanNextStep", () => {
  /** @scenario "A peer asks the entitlement capability for the next step" */
  it("names the rung the self-serve catalogue sells above a paid tiered plan", async () => {
    const { app } = pricedApp({ pricingModel: "TIERED", currency: "USD" });

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
    const { app, asked } = pricedApp({ pricingModel: "TIERED", currency: "EUR" });
    const pro: Plan = {
      ...free,
      planSource: "subscription",
      type: "PRO",
      name: "Pro",
      free: false,
    };

    const step = await app.resolvePlanNextStep({ plan: pro, organizationId: "organization-1" });

    expect(asked).toEqual(["organization-1"]);
    expect(step).toMatchObject({ kind: "self_serve", tier: "LAUNCH", currency: "EUR" });
  });
});

import { planSchema, type Plan } from "@langwatch/entitlement-contract";
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

/** What a source holds beyond the contract: a provider id, a signed payload, the stored row. */
const providerDetails = {
  stripeCustomerId: "customer-marker",
  signedLicensePayload: "payload-marker",
  databaseRecord: { id: "record-marker", organizationId: "organization-1" },
};

const providerPlan = { ...free, type: "PRO", name: "Pro", free: false, ...providerDetails };

describe("entitlement resolution against provider details", () => {
  describe("when a source supplies a plan carrying provider details", () => {
    /** @scenario "Provider details do not cross the contract" */
    it.each(["license", "subscription"] as const)(
      "resolves a plan holding only contract fields from the %s source",
      async (sourceName) => {
        const app = createEntitlementTestApp({
          infrastructure: {
            baseline: free,
            [sourceName]: fixedEntitlementSource(providerPlan),
          },
        });

        const plan = await app.getActivePlan({ organizationId: "organization-1" });

        expect(plan.type).toBe("PRO");
        expect(Object.keys(plan).filter((key) => !(key in planSchema.shape))).toEqual([]);
        expect(JSON.stringify(plan)).not.toMatch(/customer-marker|payload-marker|record-marker/);
        expect(planSchema.validate(plan)).toBe(true);
      },
    );
  });
});

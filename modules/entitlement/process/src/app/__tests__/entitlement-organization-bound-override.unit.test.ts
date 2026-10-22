/**
 * One organization's own request bounds win over its plan's.
 * @see specs/security/read-rate-limits.feature
 */
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

describe("EntitlementModule.requestBound", () => {
  describe("given one organization whose read allowance is raised for it alone", () => {
    const app = createEntitlementTestApp({
      infrastructure: { baseline: free, license: fixedEntitlementSource(null) },
      config: {
        requestBounds: undefined,
        requestBoundsByOrganization: { "organization-large": { readRowsPerHour: 9_000_000 } },
      },
    });

    /** @scenario "An organization can be given a higher allowance than its plan" */
    it("answers the raised allowance for that organization and the plan's for every other", async () => {
      await expect(
        app.requestBound({ key: "readRowsPerHour", organizationId: "organization-large" }),
      ).resolves.toBe(9_000_000);
      await expect(
        app.requestBound({ key: "readRowsPerHour", organizationId: "organization-other" }),
      ).resolves.toBe(250_000);
      await expect(
        app.requestBound({ key: "readRequestsPerMinute", organizationId: "organization-large" }),
      ).resolves.toBe(300);
    });
  });
});

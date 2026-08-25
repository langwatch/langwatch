import { describe, expect, it } from "vitest";

import { UNLIMITED_PLAN } from "@langwatch/enterprise-licensing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { createSelfHostedPlanProvider } from "../self-hosted-plan-provider";

const ORGANIZATION_ID = "org-123";

/** An Enterprise plan as it comes back from a signed license today. */
const enterpriseLicensePlan = (overrides: Partial<PlanInfo> = {}): PlanInfo => ({
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  overrideAddingLimitations: false,
  maxMembers: 100,
  maxMembersLite: 50,
  maxMessagesPerMonth: 10_000_000,
  canPublish: true,
  usageUnit: "traces",
  prices: { USD: 0, EUR: 0 },
  ...overrides,
});

const providerReturning = (plan: PlanInfo) =>
  createSelfHostedPlanProvider({
    licensePlanProvider: { getActivePlan: async () => plan },
  });

const resolve = (plan: PlanInfo) =>
  providerReturning(plan).getActivePlan({ organizationId: ORGANIZATION_ID });

describe("createSelfHostedPlanProvider", () => {
  describe("given the organization holds an Enterprise license with finite limits", () => {
    /** @scenario The seat count a license sells is enforced */
    it("keeps the seat counts the license sold, because seats are the meter", async () => {
      const plan = await resolve(
        enterpriseLicensePlan({ maxMembers: 10, maxMembersLite: 5 }),
      );

      expect(plan).toMatchObject({ maxMembers: 10, maxMembersLite: 5 });
    });

    /** @scenario The seat guard stays armed on a licensed deployment */
    it("does not switch off the creation guards that enforce those seats", async () => {
      const plan = await resolve(enterpriseLicensePlan({ maxMembers: 10 }));

      expect(plan.overrideAddingLimitations).toBe(false);
    });

    /** @scenario Plan identity survives the floor */
    it("keeps the plan identity and paid status from the license", async () => {
      // Identity is never floored: the deployment really is on Enterprise.
      const plan = await resolve(enterpriseLicensePlan());

      expect(plan).toMatchObject({
        type: "ENTERPRISE",
        name: "Enterprise",
        free: false,
        planSource: "license",
      });
    });
  });

  describe("given the license withholds publishing", () => {
    /** @scenario A license that withholds publishing does not remove it */
    it("keeps publishing available", async () => {
      const plan = await resolve(enterpriseLicensePlan({ canPublish: false }));

      expect(plan.canPublish).toBe(true);
    });
  });

  describe("given the license encodes a finite message volume", () => {
    /** @scenario A license encoding a finite message volume resolves to the uncapped baseline */
    it("raises it to the baseline, since self-hosted volume is never metered", async () => {
      const plan = await resolve(
        enterpriseLicensePlan({ maxMessagesPerMonth: 10_000_000 }),
      );

      expect(plan.maxMessagesPerMonth).toBeGreaterThanOrEqual(
        UNLIMITED_PLAN.maxMessagesPerMonth,
      );
    });
  });

  describe("given the deployment has no license stored", () => {
    /** @scenario A deployment with no license still resolves to the baseline */
    it("resolves to the open-source baseline reported as a free plan source", async () => {
      const plan = await resolve(UNLIMITED_PLAN);

      expect(plan).toMatchObject({
        type: UNLIMITED_PLAN.type,
        maxMembers: UNLIMITED_PLAN.maxMembers,
        planSource: "free",
      });
    });
  });
});

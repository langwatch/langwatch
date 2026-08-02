import { describe, expect, it } from "vitest";

import { UNLIMITED_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import { createSelfHostedPlanProvider } from "../self-hosted-plan-provider";

const ORGANIZATION_ID = "org-123";

/** An Enterprise plan as it comes back from a signed license today. */
const enterpriseLicensePlan = (
  overrides: Partial<PlanInfo> = {},
): PlanInfo => ({
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
    /** @scenario An Enterprise license encoding a finite seat count resolves to the uncapped baseline */
    it("raises the seat limits to the open-source baseline", async () => {
      const plan = await resolve(enterpriseLicensePlan());

      expect(plan.maxMembers).toBeGreaterThanOrEqual(UNLIMITED_PLAN.maxMembers);
      expect(plan.maxMembersLite).toBeGreaterThanOrEqual(
        UNLIMITED_PLAN.maxMembersLite,
      );
    });

    /** @scenario A license encoding a finite message volume resolves to the uncapped baseline */
    it("raises the monthly message volume to the open-source baseline", async () => {
      const plan = await resolve(enterpriseLicensePlan());

      expect(plan.maxMessagesPerMonth).toBeGreaterThanOrEqual(
        UNLIMITED_PLAN.maxMessagesPerMonth,
      );
    });

    /** @scenario Plan identity survives the floor */
    it("keeps the plan identity and paid status from the license", async () => {
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

  describe("given the license encodes limits above the open-source baseline", () => {
    /** @scenario The floor only raises limits and never lowers them */
    it("preserves every limit the license granted", async () => {
      const beyondBaseline = Number.MAX_SAFE_INTEGER;
      const plan = await resolve(
        enterpriseLicensePlan({
          maxMembers: beyondBaseline,
          maxMembersLite: beyondBaseline,
          maxMessagesPerMonth: beyondBaseline,
        }),
      );

      expect(plan).toMatchObject({
        maxMembers: beyondBaseline,
        maxMembersLite: beyondBaseline,
        maxMessagesPerMonth: beyondBaseline,
      });
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

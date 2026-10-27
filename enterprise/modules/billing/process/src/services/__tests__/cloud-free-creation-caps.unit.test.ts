import {
  FREE_PLAN_CREATION_CAPS,
  PLAN_LIMITS,
  PlanTypes,
} from "@langwatch/enterprise-billing-contract";
import {
  licenseDataSchema,
  mapToPlanInfo,
  UNLIMITED_PLAN,
} from "@langwatch/enterprise-licensing-contract";
import { planCreationCap } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import { SaaSPlanProviderService } from "../plan-provider.service.ts";

const creationLimits = ["scenarios", "scenarioSets", "evaluators"] as const;

const noSubscription = MemoryBillingSubscriptionRepository.create(new MemoryBillingStore());

describe("cloud Free creation caps", () => {
  describe("given the cloud Free plan", () => {
    it("caps scenarios, simulations and custom evaluators at 3", () => {
      expect(PLAN_LIMITS[PlanTypes.FREE]).toMatchObject({
        maxScenarios: 3,
        maxScenarioSets: 3,
        maxEvaluators: 3,
      });
    });

    it("keeps the caps in one place", () => {
      expect(FREE_PLAN_CREATION_CAPS).toEqual({
        maxScenarios: 3,
        maxScenarioSets: 3,
        maxEvaluators: 3,
      });
    });

    it("answers the caps for an organization without a subscription on SaaS", async () => {
      const plan = await SaaSPlanProviderService.create({
        subscriptions: noSubscription,
        isSaas: true,
      }).getActivePlan("organization-1");

      for (const limitType of creationLimits) {
        expect(planCreationCap({ plan, limitType })).toEqual({ capped: true, max: 3 });
      }
    });
  });

  describe("given a paid cloud plan", () => {
    it("sets no creation cap on any paid plan", () => {
      for (const [type, plan] of Object.entries(PLAN_LIMITS)) {
        if (type === PlanTypes.FREE) continue;
        for (const limitType of creationLimits) {
          expect(planCreationCap({ plan, limitType })).toEqual({ capped: false });
        }
      }
    });
  });

  describe("given a self-hosted deployment", () => {
    describe("when it has no license", () => {
      /** @scenario Self-hosted without a license is not capped */
      it("resolves a plan with no creation caps", async () => {
        const plan = await SaaSPlanProviderService.create({
          subscriptions: noSubscription,
          isSaas: false,
        }).getActivePlan("organization-1");

        for (const limitType of creationLimits) {
          expect(planCreationCap({ plan, limitType })).toEqual({ capped: false });
          expect(planCreationCap({ plan: UNLIMITED_PLAN, limitType })).toEqual({ capped: false });
        }
      });
    });

    describe("when its license payload still carries maxScenarios", () => {
      /** @scenario Self-hosted with a license is not capped */
      it("does not carry the caps into the active plan", () => {
        const license = licenseDataSchema.parse({
          licenseId: "lic-acme",
          version: 1,
          organizationName: "ACME",
          email: "admin@acme.test",
          issuedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2027-01-01T00:00:00.000Z",
          plan: {
            type: "ENTERPRISE",
            name: "Enterprise",
            maxMembers: 10,
            maxMessagesPerMonth: 100_000,
            canPublish: true,
            maxScenarios: 3,
            maxEvaluators: 3,
          },
        });

        const plan = mapToPlanInfo(license);

        for (const limitType of creationLimits) {
          expect(planCreationCap({ plan, limitType })).toEqual({ capped: false });
        }
      });
    });
  });
});

import { createApiFixture } from "@langwatch/api-fixture";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { EntitlementApi, type Plan } from "@langwatch/entitlement-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { entitlementServer } from "../../entitlement.server.ts";
import { createEntitlementTestUsers } from "./entitlement.fixture.ts";

const free: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 2,
  maxMembersLite: 0,
  maxMessagesPerMonth: 50_000,
  canPublish: false,
  prices: { USD: 0, EUR: 0 },
};

const launch: Plan = {
  ...free,
  type: "LAUNCH",
  name: "Launch",
  free: false,
  maxMembers: 3,
  maxMessagesPerMonth: 120_000,
  canPublish: true,
};

async function boot({ isSaas, billing }: { isSaas: boolean; billing: BillingApi }) {
  const { logger } = createTestLogger();

  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(entitlementServer)])
    .withConfig({ entitlement: { requestBounds: undefined } })
    .withMembers({ isSaas, processName: "test" })
    .withObservability((observability) => observability.withLogging(logger))
    .provide({
      user: createEntitlementTestUsers(),
      licensing: createApiFixture<LicensingApi>({ resolve: async () => free }),
      billing,
    })
    .boot();
}

describe("entitlement's subscription source", () => {
  describe("given LangWatch Cloud and no paid license", () => {
    /** @scenario "A paying Cloud organization resolves its subscription plan" */
    it("resolves the organization's subscription plan from billing", async () => {
      const asked: string[] = [];
      const runtime = await boot({
        isSaas: true,
        billing: createApiFixture<BillingApi>({
          getActiveSubscriptionPlan: async ({ organizationId }) => {
            asked.push(organizationId);
            return launch;
          },
        }),
      });

      try {
        await expect(
          runtime.service(EntitlementApi).getActivePlan({ organizationId: "organization-1" }),
        ).resolves.toMatchObject({
          type: "LAUNCH",
          maxMessagesPerMonth: 120_000,
          planSource: "subscription",
        });
        expect(asked).toEqual(["organization-1"]);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "A Cloud organization with no paid subscription resolves billing's free plan" */
    it("resolves billing's free plan, overrides included, as the free baseline", async () => {
      const runtime = await boot({
        isSaas: true,
        billing: createApiFixture<BillingApi>({
          getActiveSubscriptionPlan: async () => ({ ...free, maxMessagesPerMonth: 75_000 }),
        }),
      });

      try {
        await expect(
          runtime.service(EntitlementApi).getActivePlan({ organizationId: "organization-1" }),
        ).resolves.toMatchObject({
          type: "FREE",
          maxMessagesPerMonth: 75_000,
          planSource: "free",
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given a self-hosted deployment and no paid license", () => {
    /** @scenario "A self-hosted deployment never reads a subscription" */
    it("never asks billing and answers the self-hosted baseline", async () => {
      const runtime = await boot({ isSaas: false, billing: createApiFixture<BillingApi>({}) });

      try {
        await expect(
          runtime.service(EntitlementApi).getActivePlan({ organizationId: "organization-1" }),
        ).resolves.toMatchObject({ planSource: "free" });
      } finally {
        await runtime.stop();
      }
    });
  });
});

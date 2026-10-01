import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { EntitlementApi, type EntitlementGrant, type Plan } from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { UNLIMITED } from "@langwatch/plans";
import { createApp, MissingProviderError, withMemoryRepositories } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * The background worker resolves a plan through the same entitlement peer the
 * interactive process installs, over the same billing and licensing sources.
 * @see specs/automations/worker-plan-resolution.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { entitlementServer } from "../../entitlement.server.ts";
import { createEntitlementTestUsers } from "./entitlement.fixture.ts";

const ORGANIZATION = "organization-1";

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

const launch: Plan = { ...free, type: "LAUNCH", name: "Launch", free: false, maxMembers: 3 };

const enterprise: Plan = {
  ...free,
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  maxMembers: 42,
  maxMessagesPerMonth: UNLIMITED,
  canPublish: true,
};

const unlicensed: EntitlementGrant = { granted: true, plan: free };

type Sources = Readonly<{
  role?: "api" | "worker";
  isSaas: boolean;
  billing?: BillingApi;
  licence?: EntitlementGrant;
}>;

function bootOn({ role = "worker", isSaas, billing, licence = unlicensed }: Sources) {
  const { logger } = createTestLogger();
  return createApp({ role })
    .withModules([withMemoryRepositories(entitlementServer)])
    .withConfig({ entitlement: { requestBounds: undefined } })
    .withMembers({ isSaas, processName: `langwatch-${role}` })
    .withObservability((observability) => observability.withLogging(logger))
    .provide({
      user: createEntitlementTestUsers(),
      licensing: createApiFixture<LicensingApi>({ resolve: async () => licence }),
      billing: billing ?? createApiFixture<BillingApi>({}),
      trace: createApiFixture<TraceApi>({}),
      organization: createApiFixture<OrganizationApi>({}),
      project: createApiFixture<ProjectApi>({}),
    })
    .boot();
}

async function planOn(sources: Sources): Promise<Plan> {
  const runtime = await bootOn(sources);
  try {
    return await runtime.service(EntitlementApi).getActivePlan({ organizationId: ORGANIZATION });
  } finally {
    await runtime.stop();
  }
}

const billingAnswering = (plan: (organizationId: string) => Plan) =>
  createApiFixture<BillingApi>({
    getActiveSubscriptionPlan: async ({ organizationId }) => plan(organizationId),
  });

describe("given the entitlement module installed on the worker role", () => {
  describe("when a hosted deployment resolves an organization's plan", () => {
    /** @scenario "A paying organization resolves onto its own plan in this process" */
    it("answers the subscription's plan, the same one the api role answers", async () => {
      const billing = billingAnswering((id) => (id === ORGANIZATION ? launch : free));

      const worker = await planOn({ isSaas: true, billing });
      const api = await planOn({ role: "api", isSaas: true, billing });

      expect(worker).toMatchObject({ type: "LAUNCH", planSource: "subscription" });
      expect(worker).toEqual(api);
      await expect(
        planOn({ isSaas: true, billing: billingAnswering(() => free) }),
      ).resolves.toMatchObject({ type: "FREE", planSource: "free" });
    });

    /** @scenario "An enterprise organization's webhook entitlement is answered here" */
    it("carries the webhook entitlement the plan's tier grants, and only that tier's", async () => {
      await expect(
        planOn({ isSaas: true, billing: billingAnswering(() => enterprise) }),
      ).resolves.toMatchObject({ type: "ENTERPRISE", webhookEndpointsEnabled: true });

      const paid = await planOn({ isSaas: true, billing: billingAnswering(() => launch) });
      expect(paid.webhookEndpointsEnabled).toBeUndefined();

      const withheld = await planOn({
        isSaas: true,
        billing: billingAnswering(() => ({ ...enterprise, webhookEndpointsEnabled: false })),
      });
      expect(withheld.webhookEndpointsEnabled).toBe(false);
    });
  });

  describe("when a self-hosted deployment resolves an organization's plan", () => {
    /** @scenario "A self-hosted deployment resolves the unlimited baseline here too" */
    it("answers the unlimited baseline and never asks billing", async () => {
      const plan = await planOn({ isSaas: false, billing: createApiFixture<BillingApi>({}) });

      expect(plan).toMatchObject({ planSource: "free", maxMembers: UNLIMITED });
      expect(plan.visibilityDays ?? null).toBeNull();
    });

    /** @scenario "A licensed self-hosted deployment resolves the plan its licence names here too" */
    it("answers the licence's plan with the seats it sold and unmetered volume", async () => {
      const plan = await planOn({ isSaas: false, licence: { granted: true, plan: enterprise } });

      expect(plan).toMatchObject({
        type: "ENTERPRISE",
        planSource: "license",
        maxMembers: 42,
        maxMessagesPerMonth: UNLIMITED,
      });
    });

    /** @scenario "A licence predating a tier entitlement still carries it here" */
    it("fills the webhook entitlement a pre-flag Enterprise licence leaves unanswered", async () => {
      const preFlag: Plan = { ...enterprise, webhookEndpointsEnabled: undefined };

      await expect(
        planOn({ isSaas: false, licence: { granted: true, plan: preFlag } }),
      ).resolves.toMatchObject({ planSource: "license", webhookEndpointsEnabled: true });
    });
  });

  describe("when the worker boots without a plan source", () => {
    /** @scenario "A worker without a plan source never boots" */
    it("refuses the boot, naming the dependency and its token", async () => {
      const { logger } = createTestLogger();
      const boot = Promise.resolve().then(() =>
        createApp({ role: "worker" })
          .withModules([withMemoryRepositories(entitlementServer)])
          .withConfig({ entitlement: { requestBounds: undefined } })
          .withMembers({ isSaas: true, processName: "langwatch-worker" })
          .withObservability((observability) => observability.withLogging(logger))
          .provide({
            user: createEntitlementTestUsers(),
            licensing: createApiFixture<LicensingApi>({ resolve: async () => unlicensed }),
            trace: createApiFixture<TraceApi>({}),
            organization: createApiFixture<OrganizationApi>({}),
            project: createApiFixture<ProjectApi>({}),
          })
          // @ts-expect-error MissingSupply: the compiler refuses a process that supplies no billing
          .boot(),
      );

      await expect(boot).rejects.toBeInstanceOf(MissingProviderError);
      await expect(boot).rejects.toMatchObject({
        feature: "entitlement",
        dependencyKey: "billing",
      });
    });
  });

  describe("when the worker's plan application resolves a tier", () => {
    /** @scenario "A worker composes the licence source over the one client it opened" */
    it("asks the installed licensing peer, the same one every other read uses", async () => {
      const asked: string[] = [];
      const runtime = await createApp({ role: "worker" })
        .withModules([withMemoryRepositories(entitlementServer)])
        .withConfig({ entitlement: { requestBounds: undefined } })
        .withMembers({ isSaas: false, processName: "langwatch-worker" })
        .withObservability((observability) => observability.withLogging(createTestLogger().logger))
        .provide({
          user: createEntitlementTestUsers(),
          licensing: createApiFixture<LicensingApi>({
            resolve: async ({ organizationId }) => {
              asked.push(organizationId);
              return { granted: true, plan: enterprise };
            },
          }),
          billing: createApiFixture<BillingApi>({}),
          trace: createApiFixture<TraceApi>({}),
          organization: createApiFixture<OrganizationApi>({}),
          project: createApiFixture<ProjectApi>({}),
        })
        .boot();

      try {
        await expect(
          runtime.service(EntitlementApi).requestBound({
            key: "tracesPageSizeMax",
            organizationId: ORGANIZATION,
          }),
        ).resolves.toBeGreaterThan(0);
        expect(asked).toEqual([ORGANIZATION]);
      } finally {
        await runtime.stop();
      }
    });
  });
});

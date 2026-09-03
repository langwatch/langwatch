import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import {
  ENTITLEMENTS_BY_PLAN_TYPE,
  UNLIMITED_PLAN,
} from "@langwatch/enterprise-licensing-contract";
import type { EntitlementSource, Plan } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";
import type {
  BillingSubscriptionRecord,
  BillingSubscriptionRepository,
} from "../../ports/subscription.port";
import { deploymentPlanSources } from "../deployment-plan-sources.service";

/**
 * Spec: packages/enterprise/features/billing/specs/deployment-plan-sources.feature
 *
 * The policy both processes resolve through, asserted where it is written
 * rather than twice over in two composition roots.
 */

const subscription = (
  overrides: Partial<BillingSubscriptionRecord> = {},
): BillingSubscriptionRecord => ({
  id: "sub-1",
  organizationId: "org-1",
  status: "ACTIVE",
  plan: PlanTypes.LAUNCH,
  stripeSubscriptionId: "stripe-1",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  startDate: new Date("2026-09-01T00:00:00.000Z"),
  endDate: null,
  maxMembers: null,
  maxMembersLite: null,
  maxMessagesPerMonth: null,
  lastPaymentFailedDate: null,
  ...overrides,
});

/** The one read the subscription source makes; nothing else is exercised. */
function subscriptions(active: BillingSubscriptionRecord | null): BillingSubscriptionRepository {
  return {
    tryFindActive: async () => active,
  } as unknown as BillingSubscriptionRepository;
}

describe("given the plan sources a deployment resolves through", () => {
  describe("when the deployment is hosted", () => {
    /** @scenario "A hosted deployment starts every organization on the free plan" */
    it("starts every organization on the hosted free plan", () => {
      const sources = deploymentPlanSources({ isSaas: true });

      expect(sources.baseline.type).toBe(PlanTypes.FREE);
      expect(sources.baseline.free).toBe(true);
      expect(sources.baseline.visibilityDays).toBeGreaterThan(0);
      expect(sources.baseline.maxMembers).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });

    /** @scenario "A paid source exists only where the subscription rows do" */
    it("resolves a paying organization onto the plan its subscription names", async () => {
      const sources = deploymentPlanSources({
        isSaas: true,
        subscriptions: subscriptions(subscription()),
      });

      const plan = await sources.subscription?.resolve({ organizationId: "org-1" });

      expect(plan?.type).toBe(PlanTypes.LAUNCH);
      expect(plan?.free).toBe(false);
    });

    /** @scenario "A paid source exists only where the subscription rows do" */
    it("answers the free plan through the paid source for an organization holding no row", async () => {
      const sources = deploymentPlanSources({
        isSaas: true,
        subscriptions: subscriptions(null),
      });

      const plan = await sources.subscription?.resolve({ organizationId: "org-1" });

      expect(plan?.free).toBe(true);
    });
  });

  describe("when the process opened no subscription repository", () => {
    /**
     * The absence is returned rather than reported: each process names what it
     * costs in its own words, because on a hosted deployment it means every
     * paying organization reads as free.
     */
    /** @scenario "A paid source exists only where the subscription rows do" */
    it("returns no paid source at all", () => {
      expect(deploymentPlanSources({ isSaas: true }).subscription).toBeUndefined();
      expect(deploymentPlanSources({ isSaas: false }).subscription).toBeUndefined();
    });
  });

  describe("when the deployment is not the hosted one", () => {
    /**
     * The half that must not be guessed: a self-hosted install has no
     * subscription row to find, so a deployment started from the hosted free
     * plan would tease every trace older than a fortnight and cap every
     * automation at the free ceiling, having bought neither limit.
     */
    /** @scenario "A self-hosted deployment starts unlimited" */
    it("starts unlimited rather than on the hosted free plan", () => {
      const sources = deploymentPlanSources({ isSaas: false });

      expect(sources.baseline.type).toBe("OPEN_SOURCE");
      expect(sources.baseline.visibilityDays ?? null).toBeNull();
      expect(sources.baseline.maxMembers).toBe(Number.MAX_SAFE_INTEGER);
    });

    /** @scenario "A self-hosted deployment starts unlimited" */
    it("answers a free plan from the paid source, which never lifts the baseline", async () => {
      const sources = deploymentPlanSources({
        isSaas: false,
        subscriptions: subscriptions(subscription()),
      });

      const plan = await sources.subscription?.resolve({ organizationId: "org-1" });

      expect(plan?.free).toBe(true);
    });
  });

  describe("when a plan tier carries an entitlement", () => {
    /**
     * Why no tier enricher is threaded here. `applyPlanTypeEntitlements` fills
     * a tier entitlement only where the resolved plan left it undefined, and
     * every plan these sources answer already carries the ones the map names —
     * so on these two legs the enricher changed no answer. Add a tier
     * entitlement the plan table does not carry and this fails, which is where
     * the decision gets revisited rather than in production.
     */
    /** @scenario "Every tier entitlement is carried by the plan itself" */
    it("carries it on the plan the paid source answers, with nothing left to fill", async () => {
      expect(Object.keys(ENTITLEMENTS_BY_PLAN_TYPE).length).toBeGreaterThan(0);

      for (const [type, entitlements] of Object.entries(ENTITLEMENTS_BY_PLAN_TYPE)) {
        const sources = deploymentPlanSources({
          isSaas: true,
          subscriptions: subscriptions(subscription({ plan: type })),
        });

        const plan = await sources.subscription?.resolve({ organizationId: "org-1" });

        expect(plan?.type, `${type} is not a plan the subscription source can answer`).toBe(type);
        for (const [field, value] of Object.entries(entitlements ?? {})) {
          expect(plan?.[field as keyof typeof plan], `${type}.${field}`).toBe(value);
        }
      }
    });

    /** @scenario "Every tier entitlement is carried by the plan itself" */
    it("names neither baseline, so a baseline plan has nothing to fill either", () => {
      const hosted = deploymentPlanSources({ isSaas: true }).baseline;
      const selfHosted = deploymentPlanSources({ isSaas: false }).baseline;

      expect(ENTITLEMENTS_BY_PLAN_TYPE[hosted.type]).toBeUndefined();
      expect(ENTITLEMENTS_BY_PLAN_TYPE[selfHosted.type]).toBeUndefined();
    });
  });
});

/**
 * The licence leg arrives built, because verification lives in the Licensing
 * feature and a feature package may not import another feature's
 * implementation. What is decided HERE is whether the deployment resolves
 * through one at all, and what travels with it.
 */
const licensedEnterprise: Plan = {
  ...UNLIMITED_PLAN,
  planSource: "license",
  type: PlanTypes.ENTERPRISE,
  name: "Enterprise",
  free: false,
  // Unset on purpose: this is a contract minted before the flag existed, which
  // is the only leg that can leave a tier entitlement unanswered.
  webhookEndpointsEnabled: undefined,
};

function licence(plan: Plan): EntitlementSource {
  return { resolve: async () => plan };
}

describe("given a deployment that composed a licence source", () => {
  /** @scenario "A licensed deployment resolves through its licence" */
  it("returns it, so the entitlement service consults it before any other paid source", async () => {
    const sources = deploymentPlanSources({
      isSaas: false,
      license: licence(licensedEnterprise),
    });

    await expect(sources.license?.resolve({ organizationId: "org-1" })).resolves.toMatchObject({
      type: PlanTypes.ENTERPRISE,
      free: false,
    });
  });

  /**
   * The enricher travels with the licence and nothing else does. A contract
   * signed before `webhookEndpointsEnabled` existed resolves ENTERPRISE with
   * the field unset, and without this step the deployment that bought the tier
   * is refused the feature the tier sells.
   */
  /** @scenario "A licence predating a tier entitlement still carries it" */
  it("threads the tier enricher, which fills what the licence left unanswered", async () => {
    const sources = deploymentPlanSources({
      isSaas: false,
      license: licence(licensedEnterprise),
    });

    expect(sources.enrichers).toHaveLength(1);
    const enriched = await sources.enrichers?.[0]?.enrich(licensedEnterprise, {
      organizationId: "org-1",
    });

    expect(enriched).toMatchObject({ webhookEndpointsEnabled: true });
  });

  /** @scenario "A licence predating a tier entitlement still carries it" */
  it("threads no enricher where no licence source was composed, because no other leg needs one", () => {
    expect(deploymentPlanSources({ isSaas: false }).enrichers).toBeUndefined();
    expect(
      deploymentPlanSources({ isSaas: true, subscriptions: subscriptions(subscription()) })
        .enrichers,
    ).toBeUndefined();
  });

  /** @scenario "A licensed deployment resolves through its licence" */
  it("keeps the subscription source beside it on a hosted deployment", async () => {
    const sources = deploymentPlanSources({
      isSaas: true,
      license: licence(licensedEnterprise),
      subscriptions: subscriptions(subscription()),
    });

    expect(sources.license).toBeDefined();
    await expect(sources.subscription?.resolve({ organizationId: "org-1" })).resolves.toMatchObject(
      { type: PlanTypes.LAUNCH },
    );
  });
});

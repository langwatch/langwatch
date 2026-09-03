import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import type { BillingSubscriptionRepository } from "@langwatch/enterprise-billing-server";
import { describe, expect, it } from "vitest";
import {
  createWorkerPlanProvider,
  WorkerEntitlementAbsenceReportPort,
} from "../worker-plan-provider.composition";

/**
 * Spec: specs/automations/worker-plan-resolution.feature
 *
 * THE SAME ANSWER AS THE OTHER PROCESS, asserted on the same fixtures.
 *
 * These cases are `apps/api/src/app/__tests__/api-usage.composition.unit.test.ts`'s,
 * deliberately: the two roots each compose the deployment's plan provider and
 * the policy line — which baseline for which deployment kind, the subscription
 * source over it, the one tier enricher — is written in both. A type cannot
 * hold them together while the API's copy lives inside the interactive
 * application, so this file does. If either root's policy moves, the pair of
 * suites disagrees rather than production disagreeing with itself.
 */

/**
 * The row shape, taken off the one read the source makes rather than imported:
 * `BillingSubscriptionRecord` is the billing package's own and is not on its
 * public surface, and restating twelve fields here is how a fixture starts
 * disagreeing with the table it stands for.
 */
type SubscriptionRecord = NonNullable<
  Awaited<ReturnType<BillingSubscriptionRepository["tryFindActive"]>>
>;

const subscription = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
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
function subscriptions(active: SubscriptionRecord | null): BillingSubscriptionRepository {
  return {
    tryFindActive: async () => active,
  } as unknown as BillingSubscriptionRepository;
}

/** Records which plan sources the composition said it did not hold. */
class RecordingEntitlementAbsence extends WorkerEntitlementAbsenceReportPort {
  readonly sources: string[] = [];

  absent(source: "licence" | "subscription"): void {
    this.sources.push(source);
  }
}

describe("given the plan provider this process composes for itself", () => {
  describe("when the deployment is hosted and holds the subscription rows", () => {
    /** @scenario "A paying organization resolves onto its own plan in this process" */
    it("resolves a paying organization onto its subscription's plan rather than the free baseline", async () => {
      const plans = createWorkerPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(subscription()),
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.free).toBe(false);
      expect(plan.type).toBe(PlanTypes.LAUNCH);
    });

    /** @scenario "A paying organization resolves onto its own plan in this process" */
    it("names no absent subscription source, because it composed one", () => {
      const report = new RecordingEntitlementAbsence();

      createWorkerPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(subscription()),
        report,
      });

      expect(report.sources).toEqual(["licence"]);
    });

    /** @scenario "A paying organization resolves onto its own plan in this process" */
    it("still resolves the free baseline for an organization holding no subscription", async () => {
      const plans = createWorkerPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(null),
      });

      await expect(plans.getActivePlan({ organizationId: "org-1" })).resolves.toMatchObject({
        free: true,
      });
    });
  });

  describe("when the deployment is hosted and holds no subscription rows", () => {
    /** @scenario "A process that cannot read a plan says which source it is missing" */
    it("names the absence, so a paying organization reading as free is visible at boot", () => {
      const report = new RecordingEntitlementAbsence();

      createWorkerPlanProvider({ isSaas: true, report });

      expect(report.sources).toEqual(["licence", "subscription"]);
    });
  });

  describe("when the deployment is self-hosted", () => {
    /** @scenario "A self-hosted deployment resolves the unlimited baseline here too" */
    it("names no absent subscription, because a self-hosted plan never comes from one", () => {
      const report = new RecordingEntitlementAbsence();

      createWorkerPlanProvider({ isSaas: false, report });

      expect(report.sources).toEqual(["licence"]);
    });

    /**
     * The two baselines are opposites and this is the half that must not be
     * guessed: a self-hosted install has no subscription row to find, so a
     * process that started from the hosted free plan would tease every trace
     * older than a fortnight and cap every automation at the free ceiling on a
     * deployment that bought neither limit.
     */
    /** @scenario "A self-hosted deployment resolves the unlimited baseline here too" */
    it("resolves the unlimited baseline rather than the hosted free plan", async () => {
      const plans = createWorkerPlanProvider({ isSaas: false });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.type).toBe("OPEN_SOURCE");
      expect(plan.visibilityDays ?? null).toBeNull();
      expect(plan.maxMembers).toBe(Number.MAX_SAFE_INTEGER);
    });

    /**
     * A self-hosted deployment that DOES hold subscription rows — the same
     * schema ships either way — must still resolve unlimited. The subscription
     * source answers the hosted free plan when `isSaas` is false, and the
     * entitlement service discards a free plan before its own baseline, so the
     * two cannot disagree.
     */
    /** @scenario "A self-hosted deployment resolves the unlimited baseline here too" */
    it("keeps the unlimited baseline even where a subscription row exists", async () => {
      const plans = createWorkerPlanProvider({
        isSaas: false,
        subscriptions: subscriptions(subscription()),
      });

      await expect(plans.getActivePlan({ organizationId: "org-1" })).resolves.toMatchObject({
        type: "OPEN_SOURCE",
      });
    });
  });

  describe("when the webhook delivery gate reads the plan", () => {
    /**
     * The one field the gate reads, end to end. It comes off the ENTERPRISE
     * plan's own limits rather than off the tier enricher — the enricher fills
     * a tier entitlement only where the plan left it undefined, and this plan
     * does not — so what this pins is the SUBSCRIPTION path: an enterprise
     * organization whose row this process could not read resolves the free
     * baseline and has its endpoints refused.
     */
    /** @scenario "An enterprise organization's webhook entitlement is answered here" */
    it("answers the entitlement for an organization whose subscription carries the tier", async () => {
      const plans = createWorkerPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(subscription({ plan: PlanTypes.ENTERPRISE })),
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.webhookEndpointsEnabled).toBe(true);
    });

    /** @scenario "An enterprise organization's webhook entitlement is answered here" */
    it("leaves the entitlement unset for a plan whose tier does not carry it", async () => {
      const plans = createWorkerPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(subscription({ plan: PlanTypes.LAUNCH })),
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.webhookEndpointsEnabled ?? false).toBe(false);
    });

    /** @scenario "An enterprise organization's webhook entitlement is answered here" */
    it("leaves it unset for the same organization when the subscription rows cannot be read", async () => {
      const plans = createWorkerPlanProvider({ isSaas: true });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.webhookEndpointsEnabled ?? false).toBe(false);
    });
  });
});

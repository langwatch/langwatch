import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import type { BillingSubscriptionRepository } from "@langwatch/enterprise-billing-server";
import { OrganizationLicensePort } from "@langwatch/enterprise-licensing-server";
import {
  ENTERPRISE_LICENSE_KEY,
  TEST_PUBLIC_KEY,
} from "@langwatch/enterprise-licensing-server/testing";
import { describe, expect, it } from "vitest";
import {
  createWorkerPlanProvider,
  WorkerEntitlementAbsenceReportPort,
} from "../worker-plan-provider.composition";

/**
 * Spec: specs/automations/worker-plan-resolution.feature
 *
 * THE SAME ANSWER AS THE OTHER PROCESS, and now for a better reason than two
 * suites agreeing.
 *
 * Which baseline a deployment starts from, which paid source is consulted over
 * it and what that source is built from are `deploymentPlanSources`'s
 * (`@langwatch/enterprise-billing-server`), which both roots read and
 * `deployment-plan-sources.unit.test.ts` asserts. What this file pins is this
 * root's own half: the absences it names, and resolutions that prove it
 * actually reached the shared policy rather than composing a provider of its
 * own — the answers a background process reading a different plan from the
 * screen would get wrong.
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

/**
 * The licence row, as the composition reads it.
 *
 * The KEY is a genuinely signed fixture and the verifier below it is the real
 * one, so what these tests exercise is the whole licence leg: the read, the
 * signature check, the deployment-mode reading and the plan it answers.
 */
function licenses(licenseKey: string | null): OrganizationLicensePort {
  return { tryReadLicense: async () => licenseKey } as OrganizationLicensePort;
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
     * The one field the gate reads, end to end, on the SUBSCRIPTION path. It
     * comes off the ENTERPRISE plan's own limits there, so the tier enricher
     * has nothing to fill — which is why the shared policy threads it with the
     * licence and only with it. What this pins is what the subscription leg
     * answers: an enterprise organization whose row this process could not read
     * resolves the free baseline and has its endpoints refused.
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

  describe("when the deployment is self-hosted and holds the licence row", () => {
    /**
     * The answer this process was missing entirely. A licensed self-hosted
     * customer resolved the same unlimited baseline an unlicensed one does, so
     * the Enterprise tier they bought reached none of the three decisions this
     * process makes with a plan.
     */
    /** @scenario "A licensed self-hosted deployment resolves the plan its licence names here too" */
    it("resolves an activated Enterprise licence onto the plan the licence names", async () => {
      const plans = createWorkerPlanProvider({
        isSaas: false,
        licenses: licenses(ENTERPRISE_LICENSE_KEY),
        licensePublicKey: TEST_PUBLIC_KEY,
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.type).toBe(PlanTypes.ENTERPRISE);
      expect(plan.planSource).toBe("license");
      // The seats the customer bought bind, and the licence's message ceiling
      // does not: self-hosted volume is never metered.
      expect(plan.maxMembers).toBe(100);
      expect(plan.maxMessagesPerMonth).toBe(Number.MAX_SAFE_INTEGER);
    });

    /**
     * The webhook gate reads exactly this field, and the fixture licence was
     * signed before it existed. Without the tier enricher on the licence leg,
     * a licensed customer's batches would be dropped by this process while the
     * endpoint page still said they were enabled.
     */
    /** @scenario "A licence predating a tier entitlement still carries it here" */
    it("fills the webhook entitlement a licence signed before the flag left unanswered", async () => {
      const plans = createWorkerPlanProvider({
        isSaas: false,
        licenses: licenses(ENTERPRISE_LICENSE_KEY),
        licensePublicKey: TEST_PUBLIC_KEY,
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.webhookEndpointsEnabled).toBe(true);
    });

    /** @scenario "A licensed self-hosted deployment resolves the plan its licence names here too" */
    it("names no absent licence source, because it composed one", () => {
      const report = new RecordingEntitlementAbsence();

      createWorkerPlanProvider({
        isSaas: false,
        licenses: licenses(ENTERPRISE_LICENSE_KEY),
        licensePublicKey: TEST_PUBLIC_KEY,
        report,
      });

      expect(report.sources).toEqual([]);
    });

    /** @scenario "A self-hosted deployment resolves the unlimited baseline here too" */
    it("still resolves the unlimited baseline for an organization that activated nothing", async () => {
      const plans = createWorkerPlanProvider({
        isSaas: false,
        licenses: licenses(null),
        licensePublicKey: TEST_PUBLIC_KEY,
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.type).toBe("OPEN_SOURCE");
      expect(plan.maxMembers).toBe(Number.MAX_SAFE_INTEGER);
    });
  });
});

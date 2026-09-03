import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import type {
  BillingSubscriptionRecord,
  BillingSubscriptionRepository,
} from "@langwatch/enterprise-billing-server";
import { describe, expect, it } from "vitest";
import { ApiEntitlementAbsenceReport, composeApiPlanProvider } from "../api-usage.composition";

/** Records which plan sources the composition said it did not hold. */
class RecordingEntitlementAbsence extends ApiEntitlementAbsenceReport {
  readonly sources: string[] = [];

  absent(source: "licence" | "subscription" | "usage-mail" | "events-meter"): void {
    this.sources.push(source);
  }
}

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

describe("composeApiPlanProvider", () => {
  describe("given a hosted deployment holding the subscription rows", () => {
    it("resolves a paying organization onto its subscription's plan rather than the free baseline", async () => {
      const report = new RecordingEntitlementAbsence();

      const plans = composeApiPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(subscription()),
        report,
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.free).toBe(false);
      expect(plan.type).toBe(PlanTypes.LAUNCH);
    });

    it("names no absent subscription source, because it composed one", () => {
      const report = new RecordingEntitlementAbsence();

      composeApiPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(subscription()),
        report,
      });

      expect(report.sources).toEqual(["licence"]);
    });

    it("still resolves the free baseline for an organization holding no subscription", async () => {
      const plans = composeApiPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(null),
      });

      await expect(plans.getActivePlan({ organizationId: "org-1" })).resolves.toMatchObject({
        free: true,
      });
    });
  });

  describe("given a hosted deployment holding no subscription rows", () => {
    it("names the absence, so a paying organization reading as free is visible at boot", () => {
      const report = new RecordingEntitlementAbsence();

      composeApiPlanProvider({ isSaas: true, report });

      expect(report.sources).toEqual(["licence", "subscription"]);
    });
  });

  describe("given a self-hosted deployment", () => {
    it("names no absent subscription, because a self-hosted plan never comes from one", () => {
      const report = new RecordingEntitlementAbsence();

      composeApiPlanProvider({ isSaas: false, report });

      expect(report.sources).toEqual(["licence"]);
    });
  });
});

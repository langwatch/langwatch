/**
 * @vitest-environment node
 *
 * What failed payment recovery does to the plan: past due keeps it, day 21 answers Free limits
 * from the clock alone, payment restores it, cancellation ends the case.
 * @see ../../../specs/payment-recovery.feature
 */
import { getFreePlanLimits, PLAN_LIMITS, PlanTypes } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../repositories/memory/memory.billing.store.ts";
import { MemoryPaymentRecoveryRepository } from "../repositories/memory/memory.payment-recovery.repository.ts";
import { MemoryBillingSubscriptionRepository } from "../repositories/memory/memory.subscription.repository.ts";
import { BillingSubscriptionLifecycleService } from "../services/billing-subscription-lifecycle.service.ts";
import { SaaSPlanProviderService } from "../services/plan-provider.service.ts";

const DAY_0 = Temporal.Instant.from("2026-11-02T09:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

describe("Failed payment recovery and the plan", () => {
  let store: MemoryBillingStore;
  let plans: SaaSPlanProviderService;
  let recoveries: MemoryPaymentRecoveryRepository;
  let lifecycle: BillingSubscriptionLifecycleService;

  const subscriptionEvent = (status: Stripe.Subscription.Status) =>
    createApiFixture<Stripe.Subscription>({ id: "sub_stripe_1", status, ended_at: null });

  /** Runs a webhook handler past its Stripe consistency wait. */
  const settled = async (handled: Promise<void>) => {
    await vi.advanceTimersByTimeAsync(5000);
    await handled;
  };

  const at = (hours: number) => {
    vi.setSystemTime(DAY_0.epochMilliseconds + hours * HOUR_MS);
  };

  const seed = (plan: string) => {
    store.subscriptions.push({
      id: "sub_db_1",
      organizationId: "org_1",
      status: "ACTIVE",
      plan,
      stripeSubscriptionId: "sub_stripe_1",
      createdAt: DAY_0.subtract({ hours: 24 * 60 }),
      startDate: DAY_0.subtract({ hours: 24 * 60 }),
      endDate: null,
      maxMembers: 12,
      maxMembersLite: null,
      maxMessagesPerMonth: 2_000_000,
      lastPaymentFailedDate: null,
      seatsKept: null,
      seatsKeptUntil: null,
    });
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: DAY_0.epochMilliseconds, toFake: ["Date", "setTimeout"] });
    store = MemoryBillingStore.create();
    store.organizations.set("org_1", {
      id: "org_1",
      name: "ACME",
      stripeCustomerId: "cus_1",
      pricingModel: "SEAT_EVENT",
      currency: "EUR",
      selfHostedCustomer: false,
      teamIds: [],
      signupData: {},
    });
    const subscriptions = MemoryBillingSubscriptionRepository.create(store);
    plans = SaaSPlanProviderService.create({ subscriptions, isSaas: true });
    recoveries = MemoryPaymentRecoveryRepository.create(store);
    lifecycle = BillingSubscriptionLifecycleService.create({
      subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
        subscriptions,
        store,
      }),
      organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
      licenses: createApiFixture<LicensingApi>({
        getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
      }),
      stripeSubscriptions: MemoryStripeSubscriptionsChannel.create(),
      itemCalculator: { calculateQuantityForPrice: () => 0, prices: {} as never },
      host: {
        sendSlackSubscriptionEvent: async () => {},
        sendSlackBillingThresholdFailureAlert: async () => {},
        sendSlackAccountPaymentFailed: async () => {},
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given an organization on an active paid subscription", () => {
    beforeEach(() => seed(PlanTypes.GROWTH_SEAT_EUR_MONTHLY));

    /** @scenario "The day a renewal payment fails, the organization keeps its paid plan" */
    it("keeps its plan on the day the case opens", async () => {
      await recoveries.open({ subscriptionId: "sub_db_1", invoiceId: "in_1", startedAt: DAY_0 });

      expect((await plans.getActivePlan("org_1")).maxMembers).toBe(12);
    });

    /** @scenario "A past due subscription update keeps the paid plan during recovery" */
    it("keeps the paid plan and its custom limits when Stripe reports past due", async () => {
      await settled(
        lifecycle.handleSubscriptionUpdated({ subscription: subscriptionEvent("past_due") }),
      );

      expect(store.subscriptions[0]!.status).toBe("ACTIVE");
      const plan = await plans.getActivePlan("org_1");
      expect(plan.maxMembers).toBe(12);
      expect(plan.maxMessagesPerMonth).toBe(2_000_000);
    });

    /** @scenario "Events arriving in any order open one case" */
    it("opens one case at the failed charge after a past due update arrived first", async () => {
      await settled(
        lifecycle.handleSubscriptionUpdated({ subscription: subscriptionEvent("past_due") }),
      );
      at(1);

      const startedAt = Temporal.Instant.fromEpochMilliseconds(Date.now());
      expect(
        await recoveries.open({ subscriptionId: "sub_db_1", invoiceId: "in_1", startedAt }),
      ).toBe(true);
      expect(
        await recoveries.open({ subscriptionId: "sub_db_1", invoiceId: "in_1", startedAt: DAY_0 }),
      ).toBe(false);

      const open = await recoveries.findOpen();
      expect(open).toHaveLength(1);
      expect(open[0]!.startedAt).toEqual(startedAt);
    });
  });

  describe("given an open recovery case that reached day 21", () => {
    beforeEach(async () => {
      seed(PlanTypes.GROWTH_SEAT_EUR_MONTHLY);
      await recoveries.open({ subscriptionId: "sub_db_1", invoiceId: "in_1", startedAt: DAY_0 });
    });

    /** @scenario "On day 21 unpaid, the organization runs on Free plan limits" */
    it("answers the Free plan limits and keeps the subscription row", async () => {
      at(21 * 24);

      const plan = await plans.getActivePlan("org_1");

      expect(plan.maxMembers).toBe(getFreePlanLimits().maxMembers);
      expect(plan.maxMessagesPerMonth).toBe(getFreePlanLimits().maxMessagesPerMonth);
      expect(store.subscriptions[0]).toMatchObject({ status: "ACTIVE", maxMembers: 12 });
    });

    /** @scenario "A paused organization still reads its older traces in full" */
    it("answers no visibility window, unlike the Free plan", async () => {
      at(21 * 24);

      expect(getFreePlanLimits().visibilityDays).toBe(14);
      expect((await plans.getActivePlan("org_1")).visibilityDays).toBeUndefined();
    });

    /** @scenario "The pause takes effect at day 21 even when the sweep is late" */
    it("answers Free limits at day 21 and one hour with no sweep run", async () => {
      at(21 * 24 - 1);
      expect((await plans.getActivePlan("org_1")).maxMembers).toBe(12);

      at(21 * 24 + 1);
      expect((await plans.getActivePlan("org_1")).maxMembers).toBe(getFreePlanLimits().maxMembers);
    });

    /** @scenario "Paying the invoice on <stage> restores the paid plan at once" */
    it("answers the paid plan with its limits the moment the case closes", async () => {
      at(30 * 24);

      await recoveries.close({ subscriptionId: "sub_db_1", invoiceId: "in_1" });

      expect((await plans.getActivePlan("org_1")).maxMembers).toBe(12);
    });

    /** @scenario "A subscription Stripe marks unpaid stays paused, not cancelled" */
    it("stays paused and payable when Stripe reports the subscription unpaid", async () => {
      at(25 * 24);

      await settled(
        lifecycle.handleSubscriptionUpdated({ subscription: subscriptionEvent("unpaid") }),
      );

      expect(store.subscriptions[0]!.status).toBe("ACTIVE");
      expect(await recoveries.findOpen()).toHaveLength(1);
      expect((await plans.getActivePlan("org_1")).maxMembers).toBe(getFreePlanLimits().maxMembers);
    });

    /** @scenario "A subscription cancelled during recovery closes the case and lands on Free" */
    it("closes the case and lands on Free when the subscription is deleted", async () => {
      await settled(lifecycle.handleSubscriptionDeleted({ stripeSubscriptionId: "sub_stripe_1" }));

      expect(await recoveries.findOpen()).toEqual([]);
      expect(store.subscriptions[0]).toMatchObject({
        status: "CANCELLED",
        paymentRecoveryStartedAt: null,
      });
      expect((await plans.getActivePlan("org_1")).maxMembers).toBe(getFreePlanLimits().maxMembers);
    });
  });

  describe("given an Enterprise subscription with a recovery clock past day 21", () => {
    it("never answers Free limits", async () => {
      seed(PlanTypes.ENTERPRISE);
      await recoveries.open({ subscriptionId: "sub_db_1", invoiceId: "in_1", startedAt: DAY_0 });
      at(40 * 24);

      expect((await plans.getActivePlan("org_1")).maxMembers).toBe(12);
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE]).toBeDefined();
    });
  });
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @see enterprise/modules/billing/specs/stripe-webhook.feature */
import { BillingPriceCatalogue, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import type { BillingSubscriptionRecord } from "../../repositories/subscription.repository.ts";
import { BillingLifecycleAnnouncerService } from "../billing-lifecycle-announcer.service.ts";
import { EEWebhookService } from "../billing-stripe-webhook.service.ts";
import { SubscriptionItemCalculatorService } from "../subscription-item-calculator.service.ts";

const ORGANIZATION_ID = "org_upgrading";
const TIERED = { id: "db_tiered", stripeSubscriptionId: "sub_tiered", plan: "LAUNCH" };
const GROWTH = {
  id: "db_growth",
  stripeSubscriptionId: "sub_growth",
  plan: "GROWTH_SEAT_EUR_MONTHLY",
};

const licenses = createApiFixture<LicensingApi>({
  getLicenseStatus: async () => ({ hasLicense: false, valid: false }),
  removeLicense: async () => ({ removed: true }),
});

/** A real announcer; `pricingModelChanged` is recorded, and refused the given number of times. */
function announcerRefusingPricingModel({ refusals }: { refusals: number }) {
  const pricingModels: Record<string, unknown>[] = [];
  const started: Record<string, unknown>[] = [];
  let remaining = refusals;
  const unused = {
    sendBatch: async () => {},
    close: async () => {},
    waitUntilReady: async () => {},
  };
  const quiet = { send: async () => {}, ...unused };
  const announcer = BillingLifecycleAnnouncerService.create({
    subscriptions: { findLastNonCancelled: async () => null },
    organizations: { findActiveMemberIds: async () => [] },
    resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
    planLimitAlerts: { notifyPlanLimitReached: async () => {} },
    billingOrganizations: {
      getOrganizationForBilling: async () => ({ outcome: "not_usage_billed" }),
    },
  });
  announcer.connect({
    recordSubscriptionChanged: quiet,
    recordSubscriptionStarted: {
      send: async (payload: Record<string, unknown>) => {
        started.push(payload);
      },
      ...unused,
    },
    recordCheckoutCompleted: quiet,
    recordUsageBillingChanged: quiet,
    recordAudit: quiet,
    recordPlanLimitAlertSent: quiet,
    recordCheckoutCurrencySelected: quiet,
    recordPricingModelChanged: {
      send: async (payload: Record<string, unknown>) => {
        if (remaining > 0) {
          remaining--;
          throw new Error("recordPricingModelChanged refused");
        }
        pricingModels.push(payload);
      },
      ...unused,
    },
    recordSeatCheckoutPaid: quiet,
    recordSeatCheckoutsAbandoned: quiet,
  });
  return { announcer, pricingModels, started };
}

function subscriptionRow(
  row: { id: string; stripeSubscriptionId: string; plan: string },
  status: string,
): BillingSubscriptionRecord {
  return {
    ...row,
    organizationId: ORGANIZATION_ID,
    status,
    createdAt: Temporal.Now.instant(),
    startDate: Temporal.Now.instant(),
    endDate: null,
    lastPaymentFailedDate: null,
    maxMembers: null,
    maxMembersLite: null,
    maxMessagesPerMonth: null,
  };
}

function setup({
  growthStatus,
  tieredStatus = SubscriptionStatus.ACTIVE,
  pricingModelRefusals = 0,
}: {
  growthStatus: string;
  tieredStatus?: string | null;
  pricingModelRefusals?: number;
}) {
  const store = MemoryBillingStore.create();
  store.organizations.set(ORGANIZATION_ID, {
    id: ORGANIZATION_ID,
    name: "Upgrading Org",
    stripeCustomerId: "cus_upgrading",
    pricingModel: "TIERED",
    currency: "EUR",
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
  });
  if (tieredStatus) store.subscriptions.push(subscriptionRow(TIERED, tieredStatus));
  store.subscriptions.push(subscriptionRow(GROWTH, growthStatus));

  const stripe = MemoryStripeSubscriptionsChannel.create();
  const slackConfirmations: string[] = [];
  for (const id of [GROWTH.stripeSubscriptionId, TIERED.stripeSubscriptionId]) {
    stripe.seed({
      subscription: { id, status: "active", canceledAt: null, billingThreshold: null, items: [] },
    });
  }
  const { announcer, pricingModels, started } = announcerRefusingPricingModel({
    refusals: pricingModelRefusals,
  });
  const service = EEWebhookService.create({
    subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
      subscriptions: MemoryBillingSubscriptionRepository.create(store),
      store,
    }),
    organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
    stripeSubscriptions: stripe,
    itemCalculator: SubscriptionItemCalculatorService.create(
      BillingPriceCatalogue.create("test").prices,
    ),
    licenses,
    host: {
      sendSlackSubscriptionEvent: async (event) => {
        slackConfirmations.push(event.type);
      },
      sendSlackBillingThresholdFailureAlert: async () => {},
    },
    announcer,
  });
  const statusOf = (id: string) => store.subscriptions.find((row) => row.id === id)?.status;
  return { service, stripe, pricingModels, started, slackConfirmations, statusOf };
}

/** Lets Stripe's consistency wait pass; a rejection is caught first so it stays the caller's. */
const settle = async <T>(promise: Promise<T>): Promise<T> => {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(2000);
  const settled = await outcome;
  if ("error" in settled) throw settled.error;
  return settled.value;
};

const invoicePaid = (service: EEWebhookService) =>
  settle(service.handleInvoicePaymentSucceeded({ subscriptionId: GROWTH.stripeSubscriptionId }));

const NO_ITEMS: Stripe.SubscriptionItem[] = [];

/** Stripe's subscription.updated payload for the seat subscription: active, no line items. */
const ACTIVE_SEAT_SUBSCRIPTION = {
  id: GROWTH.stripeSubscriptionId,
  status: "active",
  ended_at: null,
  canceled_at: null,
  items: { object: "list", data: NO_ITEMS, has_more: false, url: "/v1/subscription_items" },
} as Stripe.Subscription;

const subscriptionActive = (service: EEWebhookService) =>
  settle(service.handleSubscriptionUpdated({ subscription: ACTIVE_SEAT_SUBSCRIPTION }));

describe("Growth seat upgrade retires the tiered subscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when recording the move to seat pricing fails the first time", () => {
    /** @scenario "Retiring the old plan fails, and Stripe's redelivery retires it" */
    it("retires the tiered subscription on Stripe's redelivery", async () => {
      const { service, stripe, pricingModels, started, slackConfirmations, statusOf } = setup({
        growthStatus: SubscriptionStatus.PENDING,
        pricingModelRefusals: 1,
      });

      await expect(invoicePaid(service)).rejects.toThrow("recordPricingModelChanged refused");
      await invoicePaid(service);

      expect(statusOf(GROWTH.id)).toBe(SubscriptionStatus.ACTIVE);
      expect(statusOf(TIERED.id)).toBe(SubscriptionStatus.CANCELLED);
      expect(stripe.cancellations).toEqual([
        { subscriptionId: TIERED.stripeSubscriptionId, prorate: true },
      ]);
      expect(pricingModels).toEqual([
        expect.objectContaining({ organizationId: ORGANIZATION_ID, pricingModel: "SEAT_EVENT" }),
      ]);
      expect(started).toHaveLength(1);
      expect(slackConfirmations).toEqual(["confirmed"]);
    });
  });

  describe("when Stripe reports the subscription active before the invoice paid", () => {
    /** @scenario "The subscription update arrives before the invoice is paid" */
    it("retires the tiered subscription once", async () => {
      const { service, stripe, started, slackConfirmations, statusOf } = setup({
        growthStatus: SubscriptionStatus.PENDING,
      });

      await subscriptionActive(service);
      await invoicePaid(service);

      expect(statusOf(GROWTH.id)).toBe(SubscriptionStatus.ACTIVE);
      expect(statusOf(TIERED.id)).toBe(SubscriptionStatus.CANCELLED);
      expect(stripe.cancellations).toEqual([
        { subscriptionId: TIERED.stripeSubscriptionId, prorate: true },
      ]);
      expect(started).toHaveLength(1);
      expect(slackConfirmations).toEqual(["confirmed"]);
    });
  });

  describe("when an organization is already billed for both plans", () => {
    /** @scenario "An organization already billed for both plans is healed by its next payment" */
    it("retires the tiered subscription on the next paid invoice", async () => {
      const { service, stripe, started, slackConfirmations, statusOf } = setup({
        growthStatus: SubscriptionStatus.ACTIVE,
      });

      await invoicePaid(service);

      expect(statusOf(TIERED.id)).toBe(SubscriptionStatus.CANCELLED);
      expect(stripe.cancellations).toEqual([
        { subscriptionId: TIERED.stripeSubscriptionId, prorate: true },
      ]);
      expect(started).toEqual([]);
      expect(slackConfirmations).toEqual([]);
    });
  });

  describe("when a delayed update reports a cancelled Growth subscription active", () => {
    /** @scenario "A late activation for a cancelled Growth subscription retires nothing" */
    it("leaves the tiered subscription active", async () => {
      const { service, stripe, statusOf } = setup({ growthStatus: SubscriptionStatus.CANCELLED });

      await subscriptionActive(service);

      expect(statusOf(TIERED.id)).toBe(SubscriptionStatus.ACTIVE);
      expect(stripe.cancellations).toEqual([]);
    });
  });

  describe("when a renewal has nothing left to retire", () => {
    /** @scenario "A renewal with nothing left to retire changes nothing" */
    it("cancels nothing and announces no pricing model", async () => {
      const { service, stripe, pricingModels } = setup({
        growthStatus: SubscriptionStatus.ACTIVE,
        tieredStatus: null,
      });

      await invoicePaid(service);
      await subscriptionActive(service);

      expect(stripe.cancellations).toEqual([]);
      expect(pricingModels).toEqual([]);
    });
  });
});

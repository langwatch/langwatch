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

/** A real announcer; `supersededPlansFound` is recorded, and refused the given number of times. */
function announcerRefusingSupersededPlans({ refusals }: { refusals: number }) {
  const pricingModels: Record<string, unknown>[] = [];
  const superseded: Record<string, unknown>[] = [];
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
    retireTieredPlans: async () => {},
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
        pricingModels.push(payload);
      },
      ...unused,
    },
    recordSeatCheckoutPaid: quiet,
    recordSeatCheckoutsAbandoned: quiet,
    recordSupersededPlansFound: {
      send: async (payload: Record<string, unknown>) => {
        if (remaining > 0) {
          remaining--;
          throw new Error("recordSupersededPlansFound refused");
        }
        superseded.push(payload);
      },
      ...unused,
    },
  });
  return { announcer, pricingModels, started, superseded };
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
    seatsKept: null,
    seatsKeptUntil: null,
    maxMembers: null,
    maxMembersLite: null,
    maxMessagesPerMonth: null,
  };
}

function setup({
  growthStatus,
  tieredStatus = SubscriptionStatus.ACTIVE,
  supersededRefusals = 0,
  growthAtStripe = "active",
}: {
  growthStatus: string;
  growthAtStripe?: "active" | "canceled";
  tieredStatus?: string | null;
  supersededRefusals?: number;
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
  for (const [id, status] of [
    [GROWTH.stripeSubscriptionId, growthAtStripe],
    [TIERED.stripeSubscriptionId, "active"],
  ] as const) {
    stripe.seed({
      subscription: { id, status, canceledAt: null, billingThreshold: null, items: [] },
    });
  }
  const { announcer, pricingModels, started, superseded } = announcerRefusingSupersededPlans({
    refusals: supersededRefusals,
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
  return { service, stripe, pricingModels, started, superseded, slackConfirmations, statusOf };
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

/** The fact the webhook records for the seat subscription, whatever its stamp. */
const SUPERSEDED_FACT = expect.objectContaining({
  organizationId: ORGANIZATION_ID,
  seatStripeSubscriptionId: GROWTH.stripeSubscriptionId,
});

describe("Growth seat upgrade records the tiered plans it supersedes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the invoice for a new Growth seat subscription is paid", () => {
    /** @scenario "A Growth seat activation records the tiered plans it supersedes" */
    it("records the fact, moves to seat pricing and cancels nothing itself", async () => {
      const { service, stripe, pricingModels, started, superseded, slackConfirmations, statusOf } =
        setup({ growthStatus: SubscriptionStatus.PENDING });

      await invoicePaid(service);

      expect(statusOf(GROWTH.id)).toBe(SubscriptionStatus.ACTIVE);
      expect(superseded).toEqual([SUPERSEDED_FACT]);
      expect(pricingModels).toEqual([
        expect.objectContaining({ organizationId: ORGANIZATION_ID, pricingModel: "SEAT_EVENT" }),
      ]);
      expect(stripe.cancellations).toEqual([]);
      expect(statusOf(TIERED.id)).toBe(SubscriptionStatus.ACTIVE);
      expect(started).toHaveLength(1);
      expect(slackConfirmations).toEqual(["confirmed"]);
    });
  });

  describe("when recording the superseded plans fails the first time", () => {
    /** @scenario "Recording the superseded plans fails, and Stripe's redelivery records them" */
    it("fails the delivery, and the redelivery records the fact without announcing again", async () => {
      const { service, superseded, started, slackConfirmations } = setup({
        growthStatus: SubscriptionStatus.PENDING,
        supersededRefusals: 1,
      });

      await expect(invoicePaid(service)).rejects.toThrow("recordSupersededPlansFound refused");
      await invoicePaid(service);

      expect(superseded).toEqual([SUPERSEDED_FACT]);
      expect(started).toHaveLength(1);
      expect(slackConfirmations).toEqual(["confirmed"]);
    });
  });

  describe("when Stripe reports the subscription active before the invoice paid", () => {
    /** @scenario "The subscription update arrives before the invoice is paid" */
    it("records the fact from the update and announces the start once", async () => {
      const { service, stripe, started, superseded, slackConfirmations } = setup({
        growthStatus: SubscriptionStatus.PENDING,
      });

      await subscriptionActive(service);
      expect(superseded).toEqual([SUPERSEDED_FACT]);

      await invoicePaid(service);

      expect(stripe.cancellations).toEqual([]);
      expect(started).toHaveLength(1);
      expect(slackConfirmations).toEqual(["confirmed"]);
    });
  });

  describe("when an organization is already billed for both plans", () => {
    /** @scenario "An organization already billed for both plans is healed by its next payment" */
    it("records the fact on the next paid invoice and announces nothing", async () => {
      const { service, superseded, started, slackConfirmations } = setup({
        growthStatus: SubscriptionStatus.ACTIVE,
      });

      await invoicePaid(service);

      expect(superseded).toEqual([SUPERSEDED_FACT]);
      expect(started).toEqual([]);
      expect(slackConfirmations).toEqual([]);
    });
  });

  describe("when a delayed update reports a cancelled Growth subscription active", () => {
    /** @scenario "A late activation for a cancelled Growth subscription retires nothing" */
    it("changes nothing, announces nothing and records nothing", async () => {
      const { service, stripe, started, superseded, slackConfirmations, statusOf } = setup({
        growthStatus: SubscriptionStatus.CANCELLED,
        growthAtStripe: "canceled",
      });

      await subscriptionActive(service);

      expect(statusOf(GROWTH.id)).toBe(SubscriptionStatus.CANCELLED);
      expect(statusOf(TIERED.id)).toBe(SubscriptionStatus.ACTIVE);
      expect(superseded).toEqual([]);
      expect(stripe.cancellations).toEqual([]);
      expect(started).toEqual([]);
      expect(slackConfirmations).toEqual([]);
    });
  });

  describe("when Stripe confirms a subscription we cancelled is active again", () => {
    /** @scenario "An active update for a cancelled row that Stripe confirms active restores it" */
    it("activates it and records the plans it supersedes", async () => {
      const { service, started, superseded, statusOf } = setup({
        growthStatus: SubscriptionStatus.CANCELLED,
      });

      await subscriptionActive(service);

      expect(statusOf(GROWTH.id)).toBe(SubscriptionStatus.ACTIVE);
      expect(started).toHaveLength(1);
      expect(superseded).toHaveLength(1);
    });
  });

  describe("when a renewal has nothing left to retire", () => {
    /** @scenario "A renewal with nothing left to retire changes nothing" */
    it("records nothing and announces no pricing model", async () => {
      const { service, superseded, pricingModels } = setup({
        growthStatus: SubscriptionStatus.ACTIVE,
        tieredStatus: null,
      });

      await invoicePaid(service);
      await subscriptionActive(service);

      expect(superseded).toEqual([]);
      expect(pricingModels).toEqual([]);
    });
  });
});

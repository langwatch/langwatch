/**
 * @vitest-environment node
 * An Ops edit beside a Stripe checkout must leave the organization one active subscription.
 * @see ../../../../specs/billing.feature
 */
import { type StripePriceMap, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeCustomersChannel } from "../../channels/memory/memory.stripe-customers.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemorySeatEventSubscriptionRepository } from "../../repositories/memory/memory.seat-event-subscription.repository.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import type { BillingSubscriptionRecord } from "../../repositories/subscription.repository.ts";
import { BillingCheckoutCompletionService } from "../billing-checkout-completion.service.ts";
import { NO_DUPLICATE_SUBSCRIPTION_ALERTS } from "../duplicate-subscription-alert.service.ts";
import { SeatEventSubscriptionService } from "../seat-event-subscription.service.ts";
import { StripeCustomerCurrencyService } from "../stripe-customer-currency.service.ts";
import { StripeErrorTranslatorService } from "../stripe-error-translator.service.ts";

const ORG = "org_acme";
const NOW = Temporal.Instant.from("2026-11-26T12:00:00Z");
const prices = {
  GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_SEAT_USD_ANNUAL: "price_seat_usd_annual",
  GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  GROWTH_EVENTS_USD_ANNUAL: "price_events_usd_annual",
} as StripePriceMap;

/** A Growth row as a checkout leaves it, in whatever status an operator then set. */
const growthRow = (fields: Partial<BillingSubscriptionRecord>): BillingSubscriptionRecord => ({
  id: "sub_db_ops",
  organizationId: ORG,
  status: SubscriptionStatus.PENDING,
  plan: "GROWTH_SEAT_EUR_MONTHLY",
  stripeSubscriptionId: null,
  createdAt: NOW.subtract({ hours: 48 }),
  startDate: null,
  endDate: null,
  maxMembers: 3,
  maxMembersLite: null,
  maxMembersDeveloper: null,
  maxMessagesPerMonth: 100_000,
  lastPaymentFailedDate: null,
  seatsKept: null,
  seatsKeptUntil: null,
  ...fields,
});

function world() {
  const store = MemoryBillingStore.create();
  store.organizations.set(ORG, {
    id: ORG,
    name: "ACME",
    stripeCustomerId: "cus_acme",
    pricingModel: "TIERED",
    currency: "EUR",
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
  });
  const stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
  stripeSubscriptions.seed({
    subscription: {
      id: "sub_stripe_paid",
      status: "active",
      canceledAt: null,
      billingThreshold: null,
      items: [],
    },
  });
  const customers = MemoryStripeCustomersChannel.create();
  customers.seed({ id: "cus_acme", currency: "eur" });
  const announcer = {
    checkoutCompleted: vi.fn(async () => undefined),
    subscriptionActivated: vi.fn(async () => undefined),
    subscriptionCancelled: vi.fn(async () => undefined),
    checkoutCurrencySelected: vi.fn(async () => undefined),
    seatCheckoutPaid: vi.fn(async () => undefined),
    pricingModelChanged: vi.fn(async () => undefined),
    audited: vi.fn(async () => undefined),
    seatCheckoutsAbandoned: vi.fn(async () => undefined),
  };
  const duplicates = { reportDuplicateActive: vi.fn(async () => undefined) };
  const subscriptions = MemoryBillingSubscriptionRepository.create(store);
  const completion = BillingCheckoutCompletionService.create({
    subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
      subscriptions,
      store,
    }),
    organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
    stripeSubscriptions,
    itemCalculator: { calculateQuantityForPrice: () => 0, prices },
    licenses: createApiFixture<LicensingApi>({
      getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
    }),
    host: {
      sendSlackSubscriptionEvent: async () => {},
      sendSlackBillingThresholdFailureAlert: async () => {},
      sendSlackAccountPaymentFailed: async () => {},
    },
    announcer,
    duplicates,
  });
  const seats = SeatEventSubscriptionService.create({
    stripeSubscriptions,
    subscriptions: MemorySeatEventSubscriptionRepository.create(store),
    abandoned: { seatCheckoutsAbandoned: vi.fn(), audited: vi.fn() },
    duplicates: NO_DUPLICATE_SUBSCRIPTION_ALERTS,
    prices,
    customerCurrency: StripeCustomerCurrencyService.create({
      customers,
      stripeErrors: StripeErrorTranslatorService.create(),
    }),
  });

  /** Stripe's checkout completion for the pending row `pendingId`, waited out. */
  const complete = async (pendingId: string) => {
    const done = completion.dispatchCheckoutCompleted({
      event: createApiFixture<Stripe.CheckoutSessionCompletedEvent>({
        id: `evt_${pendingId}`,
        type: "checkout.session.completed",
        data: {
          object: createApiFixture<Stripe.Checkout.Session>({
            client_reference_id: `subscription_setup_${pendingId}`,
            created: Math.floor(NOW.epochMilliseconds / 1000),
            metadata: {},
          }),
        },
      }),
      subscriptionId: "sub_stripe_paid",
      organizationId: ORG,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
  };
  const active = () =>
    store.subscriptions.filter((row) => row.status === SubscriptionStatus.ACTIVE);

  return { store, seats, announcer, duplicates, stripeSubscriptions, complete, active };
}

beforeEach(() => vi.useFakeTimers({ now: NOW.epochMilliseconds, toFake: ["Date", "setTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("given an operator activated an older PENDING Growth row in Ops", () => {
  describe("when the customer opens a new seat checkout and pays it", () => {
    /** @scenario "A paid checkout lands on the active row an operator made" */
    it("lands on the operator's row and leaves exactly one active subscription", async () => {
      const { store, seats, announcer, complete, active } = world();
      store.subscriptions.push(growthRow({ status: SubscriptionStatus.ACTIVE }));
      await expect(
        seats.previewProration({ organizationId: ORG, newTotalSeats: 4 }),
      ).rejects.toMatchObject({ code: "seat_checkout_required" });

      const { subscriptionId: pendingId } = await seats.createSeatEventCheckout({
        organizationId: ORG,
        customerId: "cus_acme",
        baseUrl: "https://app.test",
        currency: "EUR",
        billingInterval: "monthly",
        membersToAdd: 5,
      });
      await complete(pendingId);

      expect(active()).toEqual([
        expect.objectContaining({
          id: "sub_db_ops",
          stripeSubscriptionId: "sub_stripe_paid",
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          maxMembers: 5,
        }),
      ]);
      expect(store.subscriptions.find((row) => row.id === pendingId)?.status).toBe(
        SubscriptionStatus.CANCELLED,
      );
      expect(announcer.seatCheckoutPaid).toHaveBeenCalledWith({
        subscriptionId: pendingId,
        organizationId: ORG,
      });
      expect(announcer.pricingModelChanged).toHaveBeenCalledWith({
        organizationId: ORG,
        pricingModel: "SEAT_EVENT",
      });
      expect(announcer.audited).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: ORG,
          action: "subscription.adoptCheckout",
          args: { pendingId, liveId: "sub_db_ops" },
        }),
      );
    });

    /** @scenario "A redelivered checkout completion changes nothing more" */
    it("changes nothing more when Stripe delivers the completion again", async () => {
      const { store, seats, complete, active } = world();
      store.subscriptions.push(growthRow({ status: SubscriptionStatus.ACTIVE }));
      const { subscriptionId: pendingId } = await seats.createSeatEventCheckout({
        organizationId: ORG,
        customerId: "cus_acme",
        baseUrl: "https://app.test",
        currency: "EUR",
        billingInterval: "monthly",
        membersToAdd: 5,
      });

      await complete(pendingId);
      await complete(pendingId);

      expect(active().map((row) => row.id)).toEqual(["sub_db_ops"]);
    });
  });
});

describe("given an operator's active Growth row with a limit beyond seats", () => {
  describe("when a seat checkout opened before the limit was set is paid", () => {
    /** @scenario "A paid checkout is never moved onto an operator's custom-limit plan" */
    it("leaves the operator's row as it was and does not adopt the checkout", async () => {
      const { store, seats, announcer, complete } = world();
      store.subscriptions.push(growthRow({ status: SubscriptionStatus.ACTIVE }));
      const { subscriptionId: pendingId } = await seats.createSeatEventCheckout({
        organizationId: ORG,
        customerId: "cus_acme",
        baseUrl: "https://app.test",
        currency: "EUR",
        billingInterval: "monthly",
        membersToAdd: 5,
      });
      store.customLimitSubscriptions.add("sub_db_ops");

      await complete(pendingId);

      expect(store.subscriptions.find((row) => row.id === "sub_db_ops")).toMatchObject({
        status: SubscriptionStatus.ACTIVE,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        stripeSubscriptionId: null,
        maxMembers: 3,
      });
      expect(announcer.audited).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "subscription.adoptCheckout" }),
      );
    });
  });
});

describe("given an operator activated the checkout's own PENDING Growth row in Ops", () => {
  describe("when the checkout completion arrives", () => {
    /** @scenario "A paid checkout on the row an operator activated starts the plan" */
    it("links that row as the one active subscription and starts the plan", async () => {
      const { store, announcer, complete, active } = world();
      store.subscriptions.push(growthRow({ status: SubscriptionStatus.ACTIVE }));

      await complete("sub_db_ops");

      expect(active()).toEqual([
        expect.objectContaining({ id: "sub_db_ops", stripeSubscriptionId: "sub_stripe_paid" }),
      ]);
      expect(announcer.pricingModelChanged).toHaveBeenCalledWith({
        organizationId: ORG,
        pricingModel: "SEAT_EVENT",
      });
    });
  });
});

describe("given the organization already holds an active Growth seat plan linked to Stripe", () => {
  describe("when a second seat checkout is paid, from a session opened before the first was paid", () => {
    const second = async () => {
      const w = world();
      w.store.subscriptions.push(
        growthRow({
          id: "sub_db_live",
          status: SubscriptionStatus.ACTIVE,
          stripeSubscriptionId: "sub_stripe_live",
        }),
        growthRow({ id: "sub_db_second" }),
      );
      w.stripeSubscriptions.seed({
        subscription: {
          id: "sub_stripe_paid",
          status: "active",
          canceledAt: null,
          billingThreshold: null,
          items: [],
          latestInvoice: { id: "in_second", status: "paid", hostedUrl: null },
        },
      });
      await w.complete("sub_db_second");
      return w;
    };

    /** @scenario "Two paid seat checkouts keep one plan" */
    it("cancels the second plan in Stripe, refunds it and keeps the first", async () => {
      const { store, stripeSubscriptions, active } = await second();

      expect(active().map((row) => row.id)).toEqual(["sub_db_live"]);
      expect(store.subscriptions.find((row) => row.id === "sub_db_second")).toMatchObject({
        status: SubscriptionStatus.CANCELLED,
        stripeSubscriptionId: "sub_stripe_paid",
      });
      expect(stripeSubscriptions.cancellations).toEqual([
        { subscriptionId: "sub_stripe_paid", prorate: false },
      ]);
      expect(stripeSubscriptions.refunds).toEqual([
        { subscriptionId: "sub_stripe_paid", outcome: "refunded" },
      ]);
    });

    /** @scenario "Two paid seat checkouts keep one plan" */
    it("alerts ops, audits it, drops the held invitations and starts nothing", async () => {
      const { announcer, duplicates } = await second();

      expect(duplicates.reportDuplicateActive).toHaveBeenCalledWith({
        organizationId: ORG,
        subscriptionIds: ["sub_db_live", "sub_db_second"],
      });
      expect(announcer.audited).toHaveBeenCalledWith(
        expect.objectContaining({ action: "subscription.refuseSecondCheckout" }),
      );
      expect(announcer.seatCheckoutsAbandoned).toHaveBeenCalledWith({
        organizationId: ORG,
        subscriptionIds: ["sub_db_second"],
      });
      expect(announcer.seatCheckoutPaid).not.toHaveBeenCalled();
      expect(announcer.checkoutCompleted).not.toHaveBeenCalled();
      expect(announcer.pricingModelChanged).not.toHaveBeenCalled();
    });

    /** @scenario "Two paid seat checkouts keep one plan" */
    it("changes nothing more when Stripe delivers the completion again", async () => {
      const { stripeSubscriptions, complete, active } = await second();

      await complete("sub_db_second");

      expect(active().map((row) => row.id)).toEqual(["sub_db_live"]);
      expect(stripeSubscriptions.cancellations).toHaveLength(1);
      expect(stripeSubscriptions.refunds).toHaveLength(1);
    });
  });
});

describe("given an older duplicate live plan the one-live-plan index exempts", () => {
  describe("when the newer plan kept beside it was cancelled and a new seat checkout is paid", () => {
    /** @scenario "A duplicate plan the index exempts still blocks a second plan" */
    it("refuses the new plan, cancels and refunds it, and keeps the older one", async () => {
      const w = world();
      w.store.subscriptions.push(
        growthRow({
          id: "sub_db_exempt",
          status: SubscriptionStatus.ACTIVE,
          stripeSubscriptionId: "sub_stripe_exempt",
        }),
        growthRow({
          id: "sub_db_kept",
          status: SubscriptionStatus.CANCELLED,
          stripeSubscriptionId: "sub_stripe_kept",
        }),
        growthRow({ id: "sub_db_new" }),
      );
      w.stripeSubscriptions.seed({
        subscription: {
          id: "sub_stripe_paid",
          status: "active",
          canceledAt: null,
          billingThreshold: null,
          items: [],
          latestInvoice: { id: "in_new", status: "paid", hostedUrl: null },
        },
      });

      await w.complete("sub_db_new");

      expect(w.active().map((row) => row.id)).toEqual(["sub_db_exempt"]);
      expect(w.stripeSubscriptions.cancellations).toEqual([
        { subscriptionId: "sub_stripe_paid", prorate: false },
      ]);
    });
  });
});

describe("given two seat checkouts for the organization are paid at the same moment", () => {
  describe("when the second one's plan is activated after the first went live past its check", () => {
    const raced = async () => {
      const w = world();
      w.store.subscriptions.push(
        growthRow({
          id: "sub_db_live",
          status: SubscriptionStatus.ACTIVE,
          stripeSubscriptionId: "sub_stripe_live",
        }),
        growthRow({ id: "sub_db_second" }),
      );
      // The second completion read the organization before the first plan went live.
      vi.spyOn(
        MemoryBillingSubscriptionRepository.prototype,
        "findLiveLinkedBeside",
      ).mockResolvedValueOnce([]);
      await w.complete("sub_db_second");
      return w;
    };
    afterEach(() => vi.restoreAllMocks());

    /** @scenario "A checkout paid in a race with another is refused as a second plan" */
    it("refuses the activation, cancels and refunds the second plan and keeps the first", async () => {
      const { store, stripeSubscriptions, duplicates, active } = await raced();

      expect(active().map((row) => row.id)).toEqual(["sub_db_live"]);
      expect(store.subscriptions.find((row) => row.id === "sub_db_second")).toMatchObject({
        status: SubscriptionStatus.CANCELLED,
        stripeSubscriptionId: "sub_stripe_paid",
      });
      expect(stripeSubscriptions.cancellations).toEqual([
        { subscriptionId: "sub_stripe_paid", prorate: false },
      ]);
      expect(duplicates.reportDuplicateActive).toHaveBeenCalledWith({
        organizationId: ORG,
        subscriptionIds: ["sub_db_live", "sub_db_second"],
      });
    });

    /** @scenario "A checkout paid in a race with another is refused as a second plan" */
    it("starts nothing for the refused checkout", async () => {
      const { announcer } = await raced();

      expect(announcer.subscriptionActivated).not.toHaveBeenCalled();
      expect(announcer.seatCheckoutPaid).not.toHaveBeenCalled();
      expect(announcer.checkoutCompleted).not.toHaveBeenCalled();
    });
  });
});

describe("given two seat checkouts are paid onto the row an operator made, at the same moment", () => {
  describe("when the second one reaches the row after the first linked it", () => {
    const raced = async () => {
      const w = world();
      const operator = growthRow({
        status: SubscriptionStatus.ACTIVE,
        stripeSubscriptionId: "sub_stripe_live",
        maxMembers: 5,
      });
      w.store.subscriptions.push(operator, growthRow({ id: "sub_db_second", maxMembers: 9 }));
      // The second completion read the operator's row while it was still unlinked.
      vi.spyOn(
        MemoryBillingSubscriptionRepository.prototype,
        "findLiveUnlinkedBeside",
      ).mockResolvedValueOnce([{ ...operator, stripeSubscriptionId: null, customLimits: false }]);
      vi.spyOn(
        MemoryBillingSubscriptionRepository.prototype,
        "findLiveLinkedBeside",
      ).mockResolvedValueOnce([]);
      await w.complete("sub_db_second");
      return w;
    };
    afterEach(() => vi.restoreAllMocks());

    /** @scenario "Two checkouts paid onto an operator's row keep the first one's plan" */
    it("keeps the first checkout's link and seats on the operator's row", async () => {
      const { store, active } = await raced();

      expect(active()).toEqual([
        expect.objectContaining({
          id: "sub_db_ops",
          stripeSubscriptionId: "sub_stripe_live",
          maxMembers: 5,
        }),
      ]);
      expect(store.subscriptions.find((row) => row.id === "sub_db_second")).toMatchObject({
        status: SubscriptionStatus.CANCELLED,
        stripeSubscriptionId: "sub_stripe_paid",
      });
    });

    /** @scenario "Two checkouts paid onto an operator's row keep the first one's plan" */
    it("cancels the second plan in Stripe and alerts ops", async () => {
      const { stripeSubscriptions, duplicates, announcer } = await raced();

      expect(stripeSubscriptions.cancellations).toEqual([
        { subscriptionId: "sub_stripe_paid", prorate: false },
      ]);
      expect(duplicates.reportDuplicateActive).toHaveBeenCalledWith({
        organizationId: ORG,
        subscriptionIds: ["sub_db_ops", "sub_db_second"],
      });
      expect(announcer.seatCheckoutPaid).not.toHaveBeenCalled();
    });
  });
});

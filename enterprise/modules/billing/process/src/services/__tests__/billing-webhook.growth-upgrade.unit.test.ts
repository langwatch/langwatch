/**
 * @vitest-environment node
 *
 * An upgrade from a tiered plan to Growth seats stops the old plan whatever order Stripe's
 * messages arrive in, and a later Growth payment heals an organization billed for both.
 * @see ../../../../specs/stripe-webhook.feature
 */
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
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
import type { BillingSubscriptionStatus } from "../../rules/billing-stripe-shapes.rules.ts";
import type { BillingLifecycleAnnouncerService } from "../billing-lifecycle-announcer.service.ts";
import { EEWebhookService } from "../billing-stripe-webhook.service.ts";

const ORG = "org_upgrading";
const GROWTH_ROW = "row_growth";
const TIERED_ROW = "row_tiered";
const GROWTH_STRIPE = "sub_growth";
const TIERED_STRIPE = "sub_tiered";

const row = (overrides: Partial<BillingSubscriptionRecord>): BillingSubscriptionRecord => ({
  id: GROWTH_ROW,
  organizationId: ORG,
  status: "PENDING",
  plan: "GROWTH_SEAT_EUR_MONTHLY",
  stripeSubscriptionId: null,
  createdAt: Temporal.Instant.from("2026-09-18T06:51:04Z"),
  startDate: null,
  endDate: null,
  maxMembers: 2,
  maxMembersLite: null,
  maxMembersDeveloper: null,
  maxMessagesPerMonth: null,
  lastPaymentFailedDate: null,
  seatsKept: null,
  seatsKeptUntil: null,
  ...overrides,
});

const atStripe = (id: string, status: BillingSubscriptionStatus = "active") => ({
  subscription: { id, status, canceledAt: null, billingThreshold: null, items: [] },
});

type Harness = {
  webhook: EEWebhookService;
  stripe: MemoryStripeSubscriptionsChannel;
  store: MemoryBillingStore;
  pricingModels: string[];
  activations: string[];
  checkoutsPaid: string[];
};

/** A tiered organization with a Growth seat row and its old tiered row, as a test lays them out. */
function harness({
  growth,
  tiered,
  tieredAtStripe = "active",
}: {
  growth: Partial<BillingSubscriptionRecord>;
  tiered: Partial<BillingSubscriptionRecord> | null;
  tieredAtStripe?: BillingSubscriptionStatus;
}): Harness {
  const store = MemoryBillingStore.create();
  store.organizations.set(ORG, {
    id: ORG,
    name: "ACME",
    stripeCustomerId: null,
    pricingModel: "TIERED",
    currency: "EUR",
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
  });
  store.subscriptions.push(row(growth));
  if (tiered) store.subscriptions.push(row({ id: TIERED_ROW, plan: "LAUNCH", ...tiered }));

  const stripe = MemoryStripeSubscriptionsChannel.create();
  stripe.seed(atStripe(GROWTH_STRIPE));
  stripe.seed(atStripe(TIERED_STRIPE, tieredAtStripe));

  const pricingModels: string[] = [];
  const activations: string[] = [];
  const checkoutsPaid: string[] = [];
  const announcer = createApiFixture<BillingLifecycleAnnouncerService>({
    pricingModelChanged: async ({ pricingModel }) => {
      pricingModels.push(pricingModel);
    },
    subscriptionActivated: async ({ subscriptionId }) => {
      activations.push(subscriptionId);
    },
    subscriptionCancelled: async () => {},
    seatCheckoutPaid: async ({ subscriptionId }) => {
      checkoutsPaid.push(subscriptionId);
    },
  });
  const subscriptions = MemoryBillingSubscriptionRepository.create(store);
  const webhook = EEWebhookService.create({
    subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
      subscriptions,
      store,
    }),
    organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
    stripeSubscriptions: stripe,
    itemCalculator: { calculateQuantityForPrice: () => 0, prices: {} as never },
    licenses: createApiFixture<LicensingApi>({
      getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
    }),
    host: {
      sendSlackSubscriptionEvent: async () => {},
      sendSlackBillingThresholdFailureAlert: async () => {},
      sendSlackAccountPaymentFailed: async () => {},
    },
    announcer,
  });
  return { webhook, stripe, store, pricingModels, activations, checkoutsPaid };
}

const checkoutCompleted = () =>
  createApiFixture<Stripe.CheckoutSessionCompletedEvent>({
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: createApiFixture<Stripe.Checkout.Session>({
        id: "cs_growth",
        mode: "subscription",
        subscription: GROWTH_STRIPE,
        customer: null,
        client_reference_id: `subscription_setup_${GROWTH_ROW}`,
        metadata: {},
        created: 1_789_714_000,
      }),
    },
  });

const subscriptionActive = () =>
  createApiFixture<Stripe.CustomerSubscriptionUpdatedEvent>({
    id: "evt_updated",
    type: "customer.subscription.updated",
    data: {
      object: createApiFixture<Stripe.Subscription>({
        id: GROWTH_STRIPE,
        status: "active",
        ended_at: null,
        items: createApiFixture<Stripe.ApiList<Stripe.SubscriptionItem>>({ data: [] }),
      }),
    },
  });

const paymentSucceeded = (id = "in_growth") =>
  createApiFixture<Stripe.InvoicePaymentSucceededEvent>({
    id: `evt_${id}`,
    type: "invoice.payment_succeeded",
    data: {
      object: createApiFixture<Stripe.Invoice>({
        id,
        subscription: GROWTH_STRIPE,
        customer: null,
        collection_method: "charge_automatically",
        billing_reason: "subscription_create",
        amount_due: 5800,
        currency: "eur",
        number: "LW-0001",
        created: 1_789_714_000,
      }),
    },
  });

const MESSAGES = {
  checkout: checkoutCompleted,
  updated: subscriptionActive,
  payment: () => paymentSucceeded(),
} as const;
type Message = keyof typeof MESSAGES;

const ORDERS: Message[][] = [
  ["checkout", "updated", "payment"],
  ["checkout", "payment", "updated"],
  ["updated", "checkout", "payment"],
  ["updated", "payment", "checkout"],
  ["payment", "checkout", "updated"],
  ["payment", "updated", "checkout"],
];

/** Starts every event before any finishes, as Stripe's parallel deliveries do. */
async function deliverTogether({ webhook }: Harness, events: Stripe.Event[]) {
  const results = Promise.all(events.map((event) => webhook.handleEvent(event)));
  await vi.advanceTimersByTimeAsync(10_000);
  return results;
}

const rowOf = ({ store }: Harness, id: string) =>
  store.subscriptions.find((subscription) => subscription.id === id);

describe("given a tiered organization upgrading to Growth seats", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "An upgrade's checkout, subscription-active and payment messages arrive together in any order and the old plan stops" */
  it.each(ORDERS)(
    "stops the old plan once when the messages arrive %s, %s, %s",
    async (...order) => {
      const upgrade = harness({
        growth: {},
        tiered: { status: "ACTIVE", stripeSubscriptionId: TIERED_STRIPE },
      });

      const results = await deliverTogether(
        upgrade,
        order.map((message) => MESSAGES[message]()),
      );

      expect(results.map((result) => result.status)).toEqual(["ok", "ok", "ok"]);
      expect(upgrade.stripe.cancellations).toEqual([
        { subscriptionId: TIERED_STRIPE, prorate: true },
      ]);
      expect(rowOf(upgrade, TIERED_ROW)?.status).toBe("CANCELLED");
      expect(upgrade.pricingModels).toContain("SEAT_EVENT");
      expect(rowOf(upgrade, GROWTH_ROW)?.status).toBe("ACTIVE");
    },
  );

  /** @scenario "An organization already billed for both plans is healed by its next Growth payment" */
  it("heals an organization billed for both plans on its next Growth payment", async () => {
    const stuck = harness({
      growth: { status: "ACTIVE", stripeSubscriptionId: GROWTH_STRIPE },
      tiered: { status: "ACTIVE", stripeSubscriptionId: TIERED_STRIPE },
    });

    const [result] = await deliverTogether(stuck, [paymentSucceeded("in_renewal")]);

    expect(result?.status).toBe("ok");
    expect(stuck.stripe.cancellations).toEqual([{ subscriptionId: TIERED_STRIPE, prorate: true }]);
    expect(rowOf(stuck, TIERED_ROW)?.status).toBe("CANCELLED");
    expect(stuck.pricingModels).toEqual(["SEAT_EVENT"]);
  });

  /** @scenario "Stripe refusing to cancel the old plan fails the delivery so Stripe sends it again" */
  it("fails the delivery when Stripe refuses the cancel, and the redelivery cancels once", async () => {
    const upgrade = harness({
      growth: { stripeSubscriptionId: GROWTH_STRIPE },
      tiered: { status: "ACTIVE", stripeSubscriptionId: TIERED_STRIPE },
    });
    upgrade.stripe.refuse({
      operation: "cancelSubscription",
      error: new Error("Stripe is unavailable"),
      times: 1,
    });

    const [first] = await deliverTogether(upgrade, [paymentSucceeded()]);

    expect(first?.status).toBe("error");
    expect(rowOf(upgrade, TIERED_ROW)?.status).toBe("ACTIVE");

    const [redelivery] = await deliverTogether(upgrade, [paymentSucceeded()]);

    expect(redelivery?.status).toBe("ok");
    expect(upgrade.stripe.cancellations).toEqual([
      { subscriptionId: TIERED_STRIPE, prorate: true },
    ]);
    expect(rowOf(upgrade, TIERED_ROW)?.status).toBe("CANCELLED");
    expect(upgrade.activations).toEqual([GROWTH_ROW]);
  });

  /** @scenario "A checkout whose old plan Stripe refuses to cancel still records the rest of the checkout" */
  it("lets waiting members in and announces the start when the old plan's cancel is refused", async () => {
    const upgrade = harness({
      growth: {},
      tiered: { status: "ACTIVE", stripeSubscriptionId: TIERED_STRIPE },
    });
    upgrade.stripe.refuse({
      operation: "cancelSubscription",
      error: new Error("Stripe is unavailable"),
    });

    const [result] = await deliverTogether(upgrade, [checkoutCompleted()]);

    expect(result?.status).toBe("error");
    expect(upgrade.checkoutsPaid).toEqual([GROWTH_ROW]);
    expect(upgrade.activations).toEqual([GROWTH_ROW]);
    expect(rowOf(upgrade, TIERED_ROW)?.status).toBe("ACTIVE");
  });

  /** @scenario "A cancel Stripe refuses because a parallel delivery already ended the old plan counts as done" */
  it("counts a cancel refused after a parallel delivery ended the old plan as done", async () => {
    const stuck = harness({
      growth: { status: "ACTIVE", stripeSubscriptionId: GROWTH_STRIPE },
      tiered: { status: "ACTIVE", stripeSubscriptionId: TIERED_STRIPE },
    });
    stuck.stripe.cancelSubscription = async () => {
      stuck.stripe.seed(atStripe(TIERED_STRIPE, "canceled"));
      throw new Error("This subscription is already canceled");
    };

    const [result] = await deliverTogether(stuck, [paymentSucceeded("in_renewal")]);

    expect(result?.status).toBe("ok");
    expect(rowOf(stuck, TIERED_ROW)?.status).toBe("CANCELLED");
  });

  /** @scenario "An old plan Stripe already ended is not cancelled at Stripe again" */
  it("does not cancel at Stripe an old plan Stripe already ended", async () => {
    const stuck = harness({
      growth: { status: "ACTIVE", stripeSubscriptionId: GROWTH_STRIPE },
      tiered: { status: "ACTIVE", stripeSubscriptionId: TIERED_STRIPE },
      tieredAtStripe: "canceled",
    });

    const [result] = await deliverTogether(stuck, [paymentSucceeded("in_renewal")]);

    expect(result?.status).toBe("ok");
    expect(stuck.stripe.cancellations).toEqual([]);
    expect(rowOf(stuck, TIERED_ROW)?.status).toBe("CANCELLED");
  });

  /** @scenario "A Growth renewal with no old plan left changes nothing" */
  it("changes nothing on a Growth renewal with no old plan left", async () => {
    const settled = harness({
      growth: { status: "ACTIVE", stripeSubscriptionId: GROWTH_STRIPE },
      tiered: null,
    });

    const [result] = await deliverTogether(settled, [paymentSucceeded("in_renewal")]);

    expect(result?.status).toBe("ok");
    expect(settled.stripe.cancellations).toEqual([]);
    expect(settled.pricingModels).toEqual([]);
  });
});

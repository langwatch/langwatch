// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/billing.feature */
import { stripeDouble } from "@langwatch/test-harness/client-doubles/stripe";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import type {
  BillingCheckoutRequest,
  BillingSubscription,
} from "../../rules/billing-stripe-shapes.rules.ts";
import { HttpStripeSubscriptionsChannel } from "../http/http.stripe-subscriptions.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../memory/memory.stripe-subscriptions.channel.ts";
import type { StripeSubscriptionsChannel } from "../stripe-subscriptions.channel.ts";

/** One active subscription with a seat line, as Stripe answers it. */
const ACTIVE = {
  id: "sub_1",
  object: "subscription",
  status: "active",
  canceled_at: null,
  billing_thresholds: null,
  items: {
    data: [
      {
        id: "si_seat",
        price: { id: "price_seat", unit_amount: 2500, recurring: { interval: "month" } },
        quantity: 2,
      },
    ],
  },
} as Stripe.Subscription;

/** The same subscription in billing's own shape, as the twin holds it. */
const ACTIVE_HELD: BillingSubscription = {
  id: "sub_1",
  status: "active",
  canceledAt: null,
  billingThreshold: null,
  items: [{ id: "si_seat", priceId: "price_seat", unitAmount: 2500, interval: "month" }],
};

const PREVIEW = {
  object: "invoice",
  currency: "usd",
  total: 1500,
  amount_due: 1500,
} as Stripe.Invoice;

const LINE_ITEMS = [
  { id: "li_1", object: "item", price: { id: "price_seat" }, quantity: 4 },
] as Stripe.LineItem[];

const CHECKOUT: BillingCheckoutRequest = {
  customerId: "cus_1",
  currency: "usd",
  lineItems: [{ price: "price_seat", quantity: 1 }],
  successUrl: "https://app.test/settings/subscription?success",
  cancelUrl: "https://app.test/settings/subscription",
  clientReferenceId: "subscription_setup_sub_1",
  allowPromotionCodes: true,
};

const missing = (message: string) =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message,
  });

/** The provider's endpoints as the SDK answers them, holding one active subscription. */
function overTheProvider(): StripeSubscriptionsChannel {
  const held = new Map<string, Stripe.Subscription>([[ACTIVE.id, ACTIVE]]);
  const find = (id: string) => {
    const subscription = held.get(id);
    if (!subscription) throw missing(`No such subscription: '${id}'`);
    return subscription;
  };
  const stripe = stripeDouble({
    subscriptions: {
      retrieve: async (id: string) => find(id),
      update: async (id: string) => find(id),
      cancel: async (id: string) => {
        const cancelled = { ...find(id), status: "canceled" };
        held.set(id, cancelled as Stripe.Subscription);
        return cancelled;
      },
    },
    checkout: {
      sessions: {
        create: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_1" }),
        listLineItems: async (id: string) => {
          if (id !== "cs_1") throw missing(`No such checkout.session: '${id}'`);
          return { object: "list", data: LINE_ITEMS, has_more: false };
        },
      },
    },
    billingPortal: {
      sessions: { create: async () => ({ url: "https://billing.stripe.com/p/session/bps_1" }) },
    },
    invoices: { createPreview: async () => PREVIEW },
  });
  return HttpStripeSubscriptionsChannel.create({ stripe });
}

function overTheTwin(): StripeSubscriptionsChannel {
  const subscriptions = MemoryStripeSubscriptionsChannel.create();
  subscriptions.seed({ subscription: ACTIVE_HELD });
  subscriptions.seedPreview({ preview: { total: 1500, amountDue: 1500, currency: "usd" } });
  subscriptions.seedCheckoutLineItems({
    checkoutSessionId: "cs_1",
    lineItems: [{ priceId: "price_seat", quantity: 4 }],
  });
  return subscriptions;
}

const tiers = [
  { tier: "the provider", compose: overTheProvider },
  { tier: "the memory twin", compose: overTheTwin },
];

describe.each(tiers)("Stripe subscriptions over $tier", ({ compose }) => {
  describe("given an active subscription", () => {
    /** @scenario "A Stripe subscription changes alike over the provider and its memory twin" */
    it("answers it with its items, keeps it on update and answers it cancelled once cancelled", async () => {
      const subscriptions = compose();

      await expect(subscriptions.getSubscription({ subscriptionId: "sub_1" })).resolves.toEqual(
        ACTIVE_HELD,
      );
      await expect(
        subscriptions.updateSubscription({
          subscriptionId: "sub_1",
          change: { items: [{ id: "si_seat", quantity: 3 }] },
        }),
      ).resolves.toMatchObject({ id: "sub_1" });

      await expect(
        subscriptions.cancelSubscription({ subscriptionId: "sub_1" }),
      ).resolves.toMatchObject({ id: "sub_1", status: "canceled" });
      await expect(
        subscriptions.getSubscription({ subscriptionId: "sub_1" }),
      ).resolves.toMatchObject({ status: "canceled" });
    });

    it("cancels it with proration when asked to prorate", async () => {
      await expect(
        compose().cancelSubscription({ subscriptionId: "sub_1", prorate: true }),
      ).resolves.toMatchObject({ id: "sub_1", status: "canceled" });
    });

    it("answers an invoice preview of a change", async () => {
      await expect(
        compose().previewInvoice({
          subscriptionId: "sub_1",
          change: { items: [{ id: "si_seat", quantity: 3 }] },
        }),
      ).resolves.toEqual({ currency: "usd", total: 1500, amountDue: 1500 });
    });
  });

  describe("when a checkout or a billing portal session is opened", () => {
    it("answers each with a url", async () => {
      const subscriptions = compose();

      const checkout = await subscriptions.createCheckoutSession(CHECKOUT);
      const portal = await subscriptions.createBillingPortalSession({
        customerId: "cus_1",
        returnUrl: "https://app.test/settings/subscription",
      });

      expect(checkout.url).toMatch(/^https:\/\//);
      expect(portal.url).toMatch(/^https:\/\//);
    });
  });

  describe("given a completed checkout session", () => {
    it("answers its line items with their quantities", async () => {
      await expect(compose().listCheckoutLineItems({ checkoutSessionId: "cs_1" })).resolves.toEqual(
        [{ priceId: "price_seat", quantity: 4 }],
      );
    });
  });

  describe("when the checkout session was never held", () => {
    it("refuses its line items with resource_missing", async () => {
      await expect(
        compose().listCheckoutLineItems({ checkoutSessionId: "cs_unknown" }),
      ).rejects.toMatchObject({ code: "resource_missing" });
    });
  });

  describe("when the subscription was never held", () => {
    it("refuses the read with resource_missing", async () => {
      await expect(
        compose().getSubscription({ subscriptionId: "sub_unknown" }),
      ).rejects.toMatchObject({ code: "resource_missing" });
    });
  });
});

describe("when a superseded subscription is cancelled with proration", () => {
  it("passes the proration to the provider", async () => {
    const cancelled: unknown[][] = [];
    const stripe = stripeDouble({
      subscriptions: {
        cancel: async (...call: unknown[]) => {
          cancelled.push(call);
          return { ...ACTIVE, status: "canceled" };
        },
      },
    });

    await HttpStripeSubscriptionsChannel.create({ stripe }).cancelSubscription({
      subscriptionId: "sub_1",
      prorate: true,
    });

    expect(cancelled).toEqual([["sub_1", { prorate: true }]]);
  });

  it("records the proration on the memory twin", async () => {
    const subscriptions = MemoryStripeSubscriptionsChannel.create();
    subscriptions.seed({ subscription: ACTIVE_HELD });

    await subscriptions.cancelSubscription({ subscriptionId: "sub_1", prorate: true });

    expect(subscriptions.cancellations).toEqual([{ subscriptionId: "sub_1", prorate: true }]);
  });
});

/** The provider's SDK recording every call it was sent, answering as `ACTIVE` would. */
function recordingProvider() {
  const calls: { operation: string; args: unknown[] }[] = [];
  const record =
    (operation: string, answer: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ operation, args });
      return answer;
    };
  const stripe = stripeDouble({
    subscriptions: { update: record("subscriptions.update", ACTIVE) },
    invoices: {
      createPreview: record("invoices.createPreview", {
        ...PREVIEW,
        lines: { object: "list", has_more: true, data: [{ proration: true, amount: 100 }] },
      }),
    },
    checkout: {
      sessions: {
        create: record("checkout.sessions.create", { url: "https://checkout.stripe.com/c/cs_1" }),
        listLineItems: record("checkout.sessions.listLineItems", {
          object: "list",
          has_more: false,
          data: [...LINE_ITEMS, { id: "li_2", object: "item", price: null, quantity: null }],
        }),
      },
    },
  });
  return { calls, subscriptions: HttpStripeSubscriptionsChannel.create({ stripe }) };
}

describe("Billing's subscription shapes over the provider", () => {
  /** @scenario "Billing's subscription shapes reach Stripe as the same requests" */
  it("answers a subscription's lines, cancellation instant and billing threshold", async () => {
    const stripe = stripeDouble({
      subscriptions: {
        retrieve: async () => ({
          ...ACTIVE,
          canceled_at: 1_699_000_000,
          billing_thresholds: { amount_gte: 75_000, reset_billing_cycle_anchor: false },
          items: {
            data: [
              ...ACTIVE.items.data,
              {
                id: "si_events",
                price: { id: "price_events", unit_amount: null, recurring: null },
              },
            ],
          },
        }),
      },
    });

    await expect(
      HttpStripeSubscriptionsChannel.create({ stripe }).getSubscription({
        subscriptionId: "sub_1",
      }),
    ).resolves.toEqual({
      id: "sub_1",
      status: "active",
      canceledAt: 1_699_000_000,
      billingThreshold: { amountGte: 75_000, resetBillingCycleAnchor: false },
      items: [
        { id: "si_seat", priceId: "price_seat", unitAmount: 2500, interval: "month" },
        { id: "si_events", priceId: "price_events", unitAmount: null, interval: null },
      ],
    });
  });

  it("sends a seat change and a billing threshold as Stripe's update parameters", async () => {
    const { calls, subscriptions } = recordingProvider();

    await subscriptions.updateSubscription({
      subscriptionId: "sub_1",
      change: {
        items: [{ id: "si_seat", quantity: 5 }],
        prorationBehavior: "always_invoice",
        prorationDate: 1_700_000_000,
        cancelAtPeriodEnd: false,
      },
    });
    await subscriptions.updateSubscription({
      subscriptionId: "sub_1",
      change: { billingThreshold: { amountGte: 75_000, resetBillingCycleAnchor: false } },
    });

    expect(calls).toEqual([
      {
        operation: "subscriptions.update",
        args: [
          "sub_1",
          {
            items: [{ id: "si_seat", quantity: 5 }],
            proration_behavior: "always_invoice",
            proration_date: 1_700_000_000,
            cancel_at_period_end: false,
          },
        ],
      },
      {
        operation: "subscriptions.update",
        args: [
          "sub_1",
          { billing_thresholds: { amount_gte: 75_000, reset_billing_cycle_anchor: false } },
        ],
      },
    ]);
  });

  it("previews a change as Stripe's subscription details and answers the invoice's total", async () => {
    const { calls, subscriptions } = recordingProvider();

    const preview = await subscriptions.previewInvoice({
      subscriptionId: "sub_1",
      change: {
        items: [{ id: "si_seat", quantity: 7 }],
        prorationBehavior: "always_invoice",
        prorationDate: 1_700_000_000,
      },
    });

    expect(preview).toEqual({ total: 1500, amountDue: 1500, currency: "usd" });
    expect(calls).toEqual([
      {
        operation: "invoices.createPreview",
        args: [
          {
            subscription: "sub_1",
            subscription_details: {
              items: [{ id: "si_seat", quantity: 7 }],
              proration_behavior: "always_invoice",
              proration_date: 1_700_000_000,
            },
          },
        ],
      },
    ]);
  });

  it("raises a checkout as a subscription with tax, billing address and tax id collected", async () => {
    const { calls, subscriptions } = recordingProvider();

    await subscriptions.createCheckoutSession({
      ...CHECKOUT,
      metadata: { selectedCurrency: "USD" },
      subscription: {
        metadata: { selectedCurrency: "USD" },
        billingCycleAnchor: 1_701_388_800,
        prorationBehavior: "create_prorations",
      },
    });

    expect(calls).toEqual([
      {
        operation: "checkout.sessions.create",
        args: [
          {
            mode: "subscription",
            currency: "usd",
            adaptive_pricing: { enabled: false },
            customer: "cus_1",
            customer_update: { address: "auto", name: "auto" },
            automatic_tax: { enabled: true },
            billing_address_collection: "required",
            tax_id_collection: { enabled: true },
            line_items: [{ price: "price_seat", quantity: 1 }],
            metadata: { selectedCurrency: "USD" },
            subscription_data: {
              metadata: { selectedCurrency: "USD" },
              billing_cycle_anchor: 1_701_388_800,
              proration_behavior: "create_prorations",
            },
            success_url: "https://app.test/settings/subscription?success",
            cancel_url: "https://app.test/settings/subscription",
            client_reference_id: "subscription_setup_sub_1",
            allow_promotion_codes: true,
          },
        ],
      },
    ]);
  });

  it("answers a completed checkout's lines with their price and quantity", async () => {
    const { subscriptions } = recordingProvider();

    await expect(
      subscriptions.listCheckoutLineItems({ checkoutSessionId: "cs_1" }),
    ).resolves.toEqual([
      { priceId: "price_seat", quantity: 4 },
      { priceId: null, quantity: null },
    ]);
  });
});

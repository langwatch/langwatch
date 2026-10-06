// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/billing.feature */
import { stripeDouble } from "@langwatch/test-harness/client-doubles/stripe";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { HttpStripeSubscriptionsChannel } from "../http/http.stripe-subscriptions.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../memory/memory.stripe-subscriptions.channel.ts";
import type { StripeSubscriptionsChannel } from "../stripe-subscriptions.channel.ts";

const ACTIVE = {
  id: "sub_1",
  object: "subscription",
  status: "active",
  items: { data: [{ id: "si_seat", price: { id: "price_seat" }, quantity: 2 }] },
} as Stripe.Subscription;

const PREVIEW = {
  object: "invoice",
  currency: "usd",
  total: 1500,
  amount_due: 1500,
} as Stripe.Invoice;

const LINE_ITEMS = [{ id: "li_1", object: "item", quantity: 4 }] as Stripe.LineItem[];

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
  subscriptions.seed({ subscription: ACTIVE });
  subscriptions.seedPreview({ invoice: PREVIEW });
  subscriptions.seedCheckoutLineItems({ checkoutSessionId: "cs_1", lineItems: LINE_ITEMS });
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

      await expect(
        subscriptions.getSubscription({ subscriptionId: "sub_1" }),
      ).resolves.toMatchObject({
        id: "sub_1",
        status: "active",
        items: { data: [{ id: "si_seat" }] },
      });
      await expect(
        subscriptions.updateSubscription({
          subscriptionId: "sub_1",
          params: { items: [{ id: "si_seat", quantity: 3 }] },
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
        compose().cancelSubscription({ subscriptionId: "sub_1", params: { prorate: true } }),
      ).resolves.toMatchObject({ id: "sub_1", status: "canceled" });
    });

    it("answers an invoice preview of a change", async () => {
      await expect(
        compose().previewInvoice({
          subscription: "sub_1",
          subscription_details: { items: [{ id: "si_seat", quantity: 3 }] },
        }),
      ).resolves.toMatchObject({ currency: "usd", total: 1500 });
    });
  });

  describe("when a checkout or a billing portal session is opened", () => {
    it("answers each with a url", async () => {
      const subscriptions = compose();

      const checkout = await subscriptions.createCheckoutSession({
        mode: "subscription",
        customer: "cus_1",
        line_items: [{ price: "price_seat", quantity: 1 }],
        success_url: "https://app.test/settings/subscription?success",
        cancel_url: "https://app.test/settings/subscription",
      });
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
      await expect(
        compose().listCheckoutLineItems({ checkoutSessionId: "cs_1" }),
      ).resolves.toMatchObject([{ quantity: 4 }]);
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
      params: { prorate: true },
    });

    expect(cancelled).toEqual([["sub_1", { prorate: true }]]);
  });

  it("records the proration on the memory twin", async () => {
    const subscriptions = MemoryStripeSubscriptionsChannel.create();
    subscriptions.seed({ subscription: ACTIVE });

    await subscriptions.cancelSubscription({ subscriptionId: "sub_1", params: { prorate: true } });

    expect(subscriptions.cancellations).toEqual([
      { subscriptionId: "sub_1", params: { prorate: true } },
    ]);
  });
});

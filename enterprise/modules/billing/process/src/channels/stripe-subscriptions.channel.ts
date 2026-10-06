// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The subscriptions subject of billing's Stripe channels (Q69): subscriptions,
 * their checkout and portal sessions, and a seat change's invoice preview, in
 * Stripe's own shapes because the item and quote rules are written over them.
 */

import type Stripe from "stripe";

export abstract class StripeSubscriptionsChannel {
  /** Throws the provider's `resource_missing` refusal for a subscription it never held. */
  abstract getSubscription(input: { subscriptionId: string }): Promise<Stripe.Subscription>;

  abstract updateSubscription(input: {
    subscriptionId: string;
    params: Stripe.SubscriptionUpdateParams;
  }): Promise<Stripe.Subscription>;

  /** `params` as Stripe takes them, `{ prorate: true }` for a superseded plan. */
  abstract cancelSubscription(input: {
    subscriptionId: string;
    params?: Stripe.SubscriptionCancelParams;
  }): Promise<Stripe.Subscription>;

  abstract createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
  ): Promise<{ url: string | null }>;

  /** The first page of a checkout session's line items; `resource_missing` for an unknown one. */
  abstract listCheckoutLineItems(input: { checkoutSessionId: string }): Promise<Stripe.LineItem[]>;

  abstract createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  abstract previewInvoice(params: Stripe.InvoiceCreatePreviewParams): Promise<Stripe.Invoice>;
}

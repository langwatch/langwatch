// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import { StripeSubscriptionsChannel } from "../stripe-subscriptions.channel.ts";

/** Stripe's subscriptions, checkout and its line items, and billing portal over billing's one client. */
export class HttpStripeSubscriptionsChannel extends StripeSubscriptionsChannel {
  private constructor(private readonly stripe: Stripe) {
    super();
  }

  static create(input: { stripe: Stripe }): HttpStripeSubscriptionsChannel {
    return new HttpStripeSubscriptionsChannel(input.stripe);
  }

  getSubscription({ subscriptionId }: { subscriptionId: string }): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  updateSubscription({
    subscriptionId,
    params,
  }: {
    subscriptionId: string;
    params: Stripe.SubscriptionUpdateParams;
  }): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.update(subscriptionId, params);
  }

  cancelSubscription({
    subscriptionId,
    params,
  }: {
    subscriptionId: string;
    params?: Stripe.SubscriptionCancelParams;
  }): Promise<Stripe.Subscription> {
    return params
      ? this.stripe.subscriptions.cancel(subscriptionId, params)
      : this.stripe.subscriptions.cancel(subscriptionId);
  }

  async createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
  ): Promise<{ url: string | null }> {
    const session = await this.stripe.checkout.sessions.create(params);
    return { url: session.url };
  }

  async listCheckoutLineItems({
    checkoutSessionId,
  }: {
    checkoutSessionId: string;
  }): Promise<Stripe.LineItem[]> {
    const page = await this.stripe.checkout.sessions.listLineItems(checkoutSessionId);
    return page.data;
  }

  async createBillingPortalSession({
    customerId,
    returnUrl,
  }: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  previewInvoice(params: Stripe.InvoiceCreatePreviewParams): Promise<Stripe.Invoice> {
    return this.stripe.invoices.createPreview(params);
  }
}

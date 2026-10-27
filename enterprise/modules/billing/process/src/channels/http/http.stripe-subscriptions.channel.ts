// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import type {
  BillingCheckoutRequest,
  BillingInvoicePreview,
  BillingPurchasedLineItem,
  BillingSubscription,
  BillingSubscriptionChange,
  BillingSubscriptionPreviewChange,
} from "../../rules/billing-stripe-shapes.rules.ts";
import { StripeSubscriptionsChannel } from "../stripe-subscriptions.channel.ts";

/** Stripe's subscriptions, checkout and its line items, and billing portal over billing's one client. */
export class HttpStripeSubscriptionsChannel extends StripeSubscriptionsChannel {
  private constructor(private readonly stripe: Stripe) {
    super();
  }

  static create(input: { stripe: Stripe }): HttpStripeSubscriptionsChannel {
    return new HttpStripeSubscriptionsChannel(input.stripe);
  }

  async getSubscription({
    subscriptionId,
  }: {
    subscriptionId: string;
  }): Promise<BillingSubscription> {
    return subscriptionOf(await this.stripe.subscriptions.retrieve(subscriptionId));
  }

  async updateSubscription({
    subscriptionId,
    change,
  }: {
    subscriptionId: string;
    change: BillingSubscriptionChange;
  }): Promise<BillingSubscription> {
    return subscriptionOf(
      await this.stripe.subscriptions.update(subscriptionId, updateParamsOf(change)),
    );
  }

  async cancelSubscription({
    subscriptionId,
    prorate,
  }: {
    subscriptionId: string;
    prorate?: boolean;
  }): Promise<BillingSubscription> {
    const cancelled =
      prorate === undefined
        ? await this.stripe.subscriptions.cancel(subscriptionId)
        : await this.stripe.subscriptions.cancel(subscriptionId, { prorate });
    return subscriptionOf(cancelled);
  }

  async createCheckoutSession(request: BillingCheckoutRequest): Promise<{ url: string | null }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      currency: request.currency,
      // The SDK's types predate adaptive pricing; the API takes it.
      ...({ adaptive_pricing: { enabled: false } } as Record<string, unknown>),
      customer: request.customerId,
      customer_update: { address: "auto", name: "auto" },
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      line_items: request.lineItems,
      ...(request.metadata ? { metadata: request.metadata } : {}),
      ...(request.subscription
        ? {
            subscription_data: {
              metadata: request.subscription.metadata,
              billing_cycle_anchor: request.subscription.billingCycleAnchor,
              proration_behavior: request.subscription.prorationBehavior,
            },
          }
        : {}),
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.clientReferenceId,
      allow_promotion_codes: request.allowPromotionCodes,
    });
    return { url: session.url };
  }

  async listCheckoutLineItems({
    checkoutSessionId,
  }: {
    checkoutSessionId: string;
  }): Promise<BillingPurchasedLineItem[]> {
    const page = await this.stripe.checkout.sessions.listLineItems(checkoutSessionId);
    return page.data.map((item) => ({
      priceId: item.price?.id ?? null,
      quantity: item.quantity ?? null,
    }));
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

  async previewInvoice({
    subscriptionId,
    change,
  }: {
    subscriptionId: string;
    change: BillingSubscriptionPreviewChange;
  }): Promise<BillingInvoicePreview> {
    const invoice = await this.stripe.invoices.createPreview({
      subscription: subscriptionId,
      subscription_details: previewDetailsOf(change),
    });
    return {
      total: invoice.total,
      amountDue: invoice.amount_due,
      currency: invoice.currency ?? null,
    };
  }
}

function subscriptionOf(subscription: Stripe.Subscription): BillingSubscription {
  const threshold = subscription.billing_thresholds ?? null;
  return {
    id: subscription.id,
    status: subscription.status,
    canceledAt: subscription.canceled_at ?? null,
    billingThreshold: threshold
      ? {
          amountGte: threshold.amount_gte,
          resetBillingCycleAnchor: threshold.reset_billing_cycle_anchor,
        }
      : null,
    items: (subscription.items?.data ?? []).map((item) => ({
      id: item.id,
      priceId: item.price.id,
      unitAmount: item.price.unit_amount ?? null,
      interval: item.price.recurring?.interval ?? null,
    })),
  };
}

function previewDetailsOf(
  change: BillingSubscriptionPreviewChange,
): Stripe.InvoiceCreatePreviewParams.SubscriptionDetails {
  const details: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails = {};
  if (change.items) details.items = change.items;
  if (change.prorationBehavior) details.proration_behavior = change.prorationBehavior;
  if (change.prorationDate !== undefined) details.proration_date = change.prorationDate;
  if (change.cancelAtPeriodEnd !== undefined) {
    details.cancel_at_period_end = change.cancelAtPeriodEnd;
  }
  return details;
}

function updateParamsOf(change: BillingSubscriptionChange): Stripe.SubscriptionUpdateParams {
  const params: Stripe.SubscriptionUpdateParams = {};
  if (change.items) params.items = change.items;
  if (change.prorationBehavior) params.proration_behavior = change.prorationBehavior;
  if (change.prorationDate !== undefined) params.proration_date = change.prorationDate;
  if (change.cancelAtPeriodEnd !== undefined) {
    params.cancel_at_period_end = change.cancelAtPeriodEnd;
  }
  if (change.billingThreshold) {
    params.billing_thresholds = {
      amount_gte: change.billingThreshold.amountGte,
      reset_billing_cycle_anchor: change.billingThreshold.resetBillingCycleAnchor,
    };
  }
  return params;
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The subscriptions subject of billing's Stripe channels (Q69): subscriptions,
 * their checkout and portal sessions, and a change's invoice preview, in
 * billing's own shapes; the http tier maps them to and from the SDK's.
 */

import type {
  BillingCheckoutRequest,
  BillingInvoicePreview,
  BillingPurchasedLineItem,
  BillingSubscription,
  BillingSubscriptionChange,
  BillingSubscriptionPreviewChange,
} from "../rules/billing-stripe-shapes.rules.ts";

export abstract class StripeSubscriptionsChannel {
  /** Throws the provider's `resource_missing` refusal for a subscription it never held. */
  abstract getSubscription(input: { subscriptionId: string }): Promise<BillingSubscription>;

  abstract updateSubscription(input: {
    subscriptionId: string;
    change: BillingSubscriptionChange;
  }): Promise<BillingSubscription>;

  /** `prorate` for a superseded plan; absent cancels as the provider defaults. */
  abstract cancelSubscription(input: {
    subscriptionId: string;
    prorate?: boolean;
  }): Promise<BillingSubscription>;

  abstract createCheckoutSession(request: BillingCheckoutRequest): Promise<{ url: string | null }>;

  /** The first page of a checkout session's line items; `resource_missing` for an unknown one. */
  abstract listCheckoutLineItems(input: {
    checkoutSessionId: string;
  }): Promise<BillingPurchasedLineItem[]>;

  abstract createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  /** Prices `change` against the subscription as the provider would invoice it now. */
  abstract previewInvoice(input: {
    subscriptionId: string;
    change: BillingSubscriptionPreviewChange;
  }): Promise<BillingInvoicePreview>;
}

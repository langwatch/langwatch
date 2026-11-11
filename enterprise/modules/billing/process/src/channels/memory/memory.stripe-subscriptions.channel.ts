// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import Stripe from "stripe";

import type {
  BillingCheckoutRequest,
  BillingInvoicePreview,
  BillingPurchasedLineItem,
  BillingSubscription,
  BillingSubscriptionChange,
  BillingSubscriptionCheckout,
  BillingSubscriptionPreviewChange,
} from "../../rules/billing-stripe-shapes.rules.ts";
import { StripeSubscriptionsChannel } from "../stripe-subscriptions.channel.ts";

type Operation = keyof StripeSubscriptionsChannel;

/**
 * Stripe's subscriptions where no provider is composed: keeps what a test seeds
 * and every change and session asked for, cancels in place (recording any
 * proration), answers seeded checkout line items, and answers an invoice
 * preview only once one is scripted (no proration arithmetic here).
 */
export class MemoryStripeSubscriptionsChannel extends StripeSubscriptionsChannel {
  readonly reads: string[] = [];
  readonly updates: { subscriptionId: string; change: BillingSubscriptionChange }[] = [];
  readonly cancellations: { subscriptionId: string; prorate?: boolean }[] = [];
  readonly checkoutSessions: { request: BillingCheckoutRequest; url: string }[] = [];
  readonly portalSessions: { customerId: string; returnUrl: string; url: string }[] = [];
  readonly previews: { subscriptionId: string; change: BillingSubscriptionPreviewChange }[] = [];
  private readonly held = new Map<string, BillingSubscription>();
  private readonly lineItems = new Map<string, BillingPurchasedLineItem[]>();
  private readonly refusals = new Map<
    Operation,
    { error: Error; allowed: number; times: number }
  >();
  private readonly subscriptionCheckouts = new Map<string, BillingSubscriptionCheckout>();
  readonly checkoutLookups: string[] = [];
  private preview: BillingInvoicePreview | undefined;
  private readonly previewsByQuantity = new Map<number, BillingInvoicePreview>();

  private constructor() {
    super();
  }

  static create(): MemoryStripeSubscriptionsChannel {
    return new MemoryStripeSubscriptionsChannel();
  }

  /** Puts a subscription at the provider, as a test declares it. */
  seed({ subscription }: { subscription: BillingSubscription }): void {
    this.held.set(subscription.id, subscription);
  }

  /** Puts a completed checkout session's line items at the provider. */
  seedCheckoutLineItems({
    checkoutSessionId,
    lineItems,
  }: {
    checkoutSessionId: string;
    lineItems: BillingPurchasedLineItem[];
  }): void {
    this.lineItems.set(checkoutSessionId, lineItems);
  }

  /** Records the checkout session, and its payment link, a subscription was bought through. */
  seedSubscriptionCheckout({
    subscriptionId,
    checkout,
  }: {
    subscriptionId: string;
    checkout: BillingSubscriptionCheckout;
  }): void {
    this.subscriptionCheckouts.set(subscriptionId, checkout);
  }

  /** What every invoice preview answers from now on, or only one moving the line to `quantity`. */
  seedPreview({ preview, quantity }: { preview: BillingInvoicePreview; quantity?: number }): void {
    if (quantity === undefined) this.preview = preview;
    else this.previewsByQuantity.set(quantity, preview);
  }

  /**
   * Makes `operation` throw `error`, as a failing provider would: after `allowed` more calls
   * succeed (default none), for `times` calls (default every one from then on).
   */
  refuse({
    operation,
    error,
    allowed = 0,
    times = Number.POSITIVE_INFINITY,
  }: {
    operation: Operation;
    error: Error;
    allowed?: number;
    times?: number;
  }): void {
    this.refusals.set(operation, { error, allowed, times });
  }

  async getSubscription({
    subscriptionId,
  }: {
    subscriptionId: string;
  }): Promise<BillingSubscription> {
    this.throwIfRefused("getSubscription");
    this.reads.push(subscriptionId);
    return this.find(subscriptionId);
  }

  async updateSubscription({
    subscriptionId,
    change,
  }: {
    subscriptionId: string;
    change: BillingSubscriptionChange;
    timeoutMs?: number;
  }): Promise<BillingSubscription> {
    this.throwIfRefused("updateSubscription");
    const subscription = this.find(subscriptionId);
    this.updates.push({ subscriptionId, change });
    return subscription;
  }

  async cancelSubscription({
    subscriptionId,
    prorate,
  }: {
    subscriptionId: string;
    prorate?: boolean;
  }): Promise<BillingSubscription> {
    this.throwIfRefused("cancelSubscription");
    const cancelled: BillingSubscription = { ...this.find(subscriptionId), status: "canceled" };
    this.held.set(subscriptionId, cancelled);
    this.cancellations.push(
      prorate === undefined ? { subscriptionId } : { subscriptionId, prorate },
    );
    return cancelled;
  }

  async listCheckoutLineItems({
    checkoutSessionId,
  }: {
    checkoutSessionId: string;
  }): Promise<BillingPurchasedLineItem[]> {
    this.throwIfRefused("listCheckoutLineItems");
    const lineItems = this.lineItems.get(checkoutSessionId);
    if (lineItems) return lineItems;
    throw missing(`No such checkout.session: '${checkoutSessionId}'`);
  }

  async findSubscriptionCheckouts({
    subscriptionId,
  }: {
    subscriptionId: string;
  }): Promise<BillingSubscriptionCheckout[]> {
    this.throwIfRefused("findSubscriptionCheckouts");
    this.checkoutLookups.push(subscriptionId);
    const checkout = this.subscriptionCheckouts.get(subscriptionId);
    return checkout ? [checkout] : [];
  }

  async createCheckoutSession(request: BillingCheckoutRequest): Promise<{ url: string | null }> {
    this.throwIfRefused("createCheckoutSession");
    const url = `https://checkout.memory.test/cs_memory_${this.checkoutSessions.length + 1}`;
    this.checkoutSessions.push({ request, url });
    return { url };
  }

  async createBillingPortalSession({
    customerId,
    returnUrl,
  }: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    this.throwIfRefused("createBillingPortalSession");
    const url = `https://billing.memory.test/bps_memory_${this.portalSessions.length + 1}`;
    this.portalSessions.push({ customerId, returnUrl, url });
    return { url };
  }

  async previewInvoice({
    subscriptionId,
    change,
  }: {
    subscriptionId: string;
    change: BillingSubscriptionPreviewChange;
  }): Promise<BillingInvoicePreview> {
    this.throwIfRefused("previewInvoice");
    this.previews.push({ subscriptionId, change });
    const quantity = change.items?.[0]?.quantity;
    const preview =
      (quantity === undefined ? undefined : this.previewsByQuantity.get(quantity)) ?? this.preview;
    if (!preview) throw new Error("no scripted Stripe invoice preview");
    return preview;
  }

  private throwIfRefused(operation: Operation): void {
    const refusal = this.refusals.get(operation);
    if (!refusal) return;
    if (refusal.allowed > 0) {
      refusal.allowed -= 1;
      return;
    }
    refusal.times -= 1;
    if (refusal.times <= 0) this.refusals.delete(operation);
    throw refusal.error;
  }

  private find(subscriptionId: string): BillingSubscription {
    const subscription = this.held.get(subscriptionId);
    if (subscription) return subscription;
    throw missing(`No such subscription: '${subscriptionId}'`);
  }
}

function missing(message: string): Error {
  return new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message,
  });
}

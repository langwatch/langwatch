// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import Stripe from "stripe";

import { StripeSubscriptionsChannel } from "../stripe-subscriptions.channel.ts";

type Operation = keyof StripeSubscriptionsChannel;

/**
 * Stripe's subscriptions where no provider is composed: keeps what a test seeds
 * and every change and session asked for, cancels in place (recording Stripe's
 * cancel params), answers seeded checkout line items, and answers an
 * invoice preview only once one is scripted (no proration arithmetic here).
 */
export class MemoryStripeSubscriptionsChannel extends StripeSubscriptionsChannel {
  readonly reads: string[] = [];
  readonly updates: { subscriptionId: string; params: Stripe.SubscriptionUpdateParams }[] = [];
  readonly cancellations: { subscriptionId: string; params?: Stripe.SubscriptionCancelParams }[] =
    [];
  readonly checkoutSessions: { params: Stripe.Checkout.SessionCreateParams; url: string }[] = [];
  readonly portalSessions: { customerId: string; returnUrl: string; url: string }[] = [];
  readonly previews: Stripe.InvoiceCreatePreviewParams[] = [];
  private readonly held = new Map<string, Stripe.Subscription>();
  private readonly lineItems = new Map<string, Stripe.LineItem[]>();
  private readonly refusals = new Map<Operation, Error>();
  private preview: Stripe.Invoice | undefined;

  private constructor() {
    super();
  }

  static create(): MemoryStripeSubscriptionsChannel {
    return new MemoryStripeSubscriptionsChannel();
  }

  /** Puts a subscription at the provider, as a test declares it. */
  seed({ subscription }: { subscription: Stripe.Subscription }): void {
    this.held.set(subscription.id, subscription);
  }

  /** Puts a completed checkout session's line items at the provider. */
  seedCheckoutLineItems({
    checkoutSessionId,
    lineItems,
  }: {
    checkoutSessionId: string;
    lineItems: Stripe.LineItem[];
  }): void {
    this.lineItems.set(checkoutSessionId, lineItems);
  }

  /** What every invoice preview answers from now on. */
  seedPreview({ invoice }: { invoice: Stripe.Invoice }): void {
    this.preview = invoice;
  }

  /** Makes `operation` throw `error` from now on, as a failing provider would. */
  refuse({ operation, error }: { operation: Operation; error: Error }): void {
    this.refusals.set(operation, error);
  }

  async getSubscription({
    subscriptionId,
  }: {
    subscriptionId: string;
  }): Promise<Stripe.Subscription> {
    this.throwIfRefused("getSubscription");
    this.reads.push(subscriptionId);
    return this.find(subscriptionId);
  }

  async updateSubscription({
    subscriptionId,
    params,
  }: {
    subscriptionId: string;
    params: Stripe.SubscriptionUpdateParams;
  }): Promise<Stripe.Subscription> {
    this.throwIfRefused("updateSubscription");
    const subscription = this.find(subscriptionId);
    this.updates.push({ subscriptionId, params });
    return subscription;
  }

  async cancelSubscription({
    subscriptionId,
    params,
  }: {
    subscriptionId: string;
    params?: Stripe.SubscriptionCancelParams;
  }): Promise<Stripe.Subscription> {
    this.throwIfRefused("cancelSubscription");
    const cancelled: Stripe.Subscription = { ...this.find(subscriptionId), status: "canceled" };
    this.held.set(subscriptionId, cancelled);
    this.cancellations.push(params ? { subscriptionId, params } : { subscriptionId });
    return cancelled;
  }

  async listCheckoutLineItems({
    checkoutSessionId,
  }: {
    checkoutSessionId: string;
  }): Promise<Stripe.LineItem[]> {
    this.throwIfRefused("listCheckoutLineItems");
    const lineItems = this.lineItems.get(checkoutSessionId);
    if (lineItems) return lineItems;
    throw missing(`No such checkout.session: '${checkoutSessionId}'`);
  }

  async createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
  ): Promise<{ url: string | null }> {
    this.throwIfRefused("createCheckoutSession");
    const url = `https://checkout.memory.test/cs_memory_${this.checkoutSessions.length + 1}`;
    this.checkoutSessions.push({ params, url });
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

  async previewInvoice(params: Stripe.InvoiceCreatePreviewParams): Promise<Stripe.Invoice> {
    this.throwIfRefused("previewInvoice");
    this.previews.push(params);
    if (!this.preview) throw new Error("no scripted Stripe invoice preview");
    return this.preview;
  }

  private throwIfRefused(operation: Operation): void {
    const refusal = this.refusals.get(operation);
    if (refusal) throw refusal;
  }

  private find(subscriptionId: string): Stripe.Subscription {
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

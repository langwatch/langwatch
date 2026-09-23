// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type ActivateSubscriptionResult,
  type CancelledSubscription,
  type SubscriptionMutationResult,
  type SubscriptionWithOrg,
  BillingWebhookSubscription,
} from "../billing-webhook-subscription.repository.ts";
import type { BillingSubscription, BillingSubscriptionRecord } from "../subscription.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/**
 * The webhook's view of the subscription aggregate. `missing_subscription`
 * means only one thing here, as it does in the Prisma twin: the row Stripe
 * named is gone.
 */
export class MemoryBillingWebhookBillingSubscription extends BillingWebhookSubscription {
  private constructor(
    private readonly subscriptions: BillingSubscription,
    private readonly store: MemoryBillingStore,
  ) {
    super();
  }

  static create(options: {
    subscriptions: BillingSubscription;
    store: MemoryBillingStore;
  }): MemoryBillingWebhookBillingSubscription {
    return new MemoryBillingWebhookBillingSubscription(options.subscriptions, options.store);
  }

  async findLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.findLastNonCancelled(organizationId);
  }

  async createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord> {
    return this.subscriptions.createPending(input);
  }

  async updateStatus(input: {
    id: string;
    status: string;
  }): Promise<SubscriptionMutationResult<BillingSubscriptionRecord>> {
    if (!this.present(input.id)) return { outcome: "missing_subscription" };
    return { outcome: "updated", subscription: await this.subscriptions.updateStatus(input) };
  }

  async updatePlan(input: {
    id: string;
    plan: string;
  }): Promise<SubscriptionMutationResult<BillingSubscriptionRecord>> {
    if (!this.present(input.id)) return { outcome: "missing_subscription" };
    return { outcome: "updated", subscription: await this.subscriptions.updatePlan(input) };
  }

  async findByStripeId(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.findByStripeId(stripeSubscriptionId);
  }

  async linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }> {
    return this.subscriptions.linkStripeId(input);
  }

  async activate(input: {
    id: string;
    previousStatus: string;
  }): Promise<ActivateSubscriptionResult> {
    if (!this.present(input.id)) return { outcome: "missing_subscription" };
    const activated = await this.subscriptions.activate(input);
    return { outcome: "activated", subscription: this.withLicense(activated) };
  }

  async recordPaymentFailure(input: { id: string; currentStatus: string }): Promise<void> {
    if (this.present(input.id)) await this.subscriptions.recordPaymentFailure(input);
  }

  async cancel(input: { id: string }): Promise<void> {
    if (this.present(input.id)) await this.subscriptions.cancel(input);
  }

  async cancelTrialSubscriptions(organizationId: string): Promise<void> {
    await this.subscriptions.cancelTrialSubscriptions(organizationId);
  }

  async migrateToSeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<CancelledSubscription[]> {
    return this.subscriptions.migrateToSeatEvent(input);
  }

  async updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionMutationResult<SubscriptionWithOrg>> {
    if (!this.present(input.id)) return { outcome: "missing_subscription" };
    const updated = await this.subscriptions.updateQuantities(input);
    return { outcome: "updated", subscription: this.withLicense(updated) };
  }

  private present(id: string): boolean {
    return this.store.subscriptions.some((subscription) => subscription.id === id);
  }

  private withLicense(
    subscription: BillingSubscriptionRecord & {
      organization: { id: string; name: string; stripeCustomerId: string | null };
    },
  ): SubscriptionWithOrg {
    const license = this.store.organizations.get(subscription.organizationId)?.license ?? null;
    return { ...subscription, organization: { ...subscription.organization, license } };
  }
}

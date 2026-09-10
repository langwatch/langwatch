// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type CancelledSubscription,
  type SubscriptionWithOrg,
  BillingWebhookSubscription,
} from "../billing-webhook-subscription.repository.ts";
import type {
  SubscriptionRepository,
  BillingSubscriptionRecord,
} from "../subscription.repository.ts";
import type { MemoryBillingStore } from "./memory-billing.store.ts";

/**
 * The webhook's nullable view of the subscription aggregate. Null means only
 * one thing here, as it does in the Prisma twin: the row Stripe named is gone.
 */
export class MemoryBillingWebhookSubscriptionRepository extends BillingWebhookSubscription {
  private constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly store: MemoryBillingStore,
  ) {
    super();
  }

  static create(options: {
    subscriptions: SubscriptionRepository;
    store: MemoryBillingStore;
  }): MemoryBillingWebhookSubscriptionRepository {
    return new MemoryBillingWebhookSubscriptionRepository(options.subscriptions, options.store);
  }

  async tryFindLastNonCancelled(
    organizationId: string,
  ): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.tryFindLastNonCancelled(organizationId);
  }

  async tryCreatePending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.createPending(input);
  }

  async tryUpdateStatus(input: {
    id: string;
    status: string;
  }): Promise<BillingSubscriptionRecord | null> {
    return this.present(input.id) ? this.subscriptions.updateStatus(input) : null;
  }

  async tryUpdatePlan(input: {
    id: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord | null> {
    return this.present(input.id) ? this.subscriptions.updatePlan(input) : null;
  }

  async tryFindByStripeId(
    stripeSubscriptionId: string,
  ): Promise<BillingSubscriptionRecord | null> {
    return this.subscriptions.tryFindByStripeId(stripeSubscriptionId);
  }

  async linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }> {
    return this.subscriptions.linkStripeId(input);
  }

  async tryActivate(input: {
    id: string;
    previousStatus: string;
  }): Promise<SubscriptionWithOrg | null> {
    if (!this.present(input.id)) return null;
    const activated = await this.subscriptions.activate(input);
    return this.withLicense(activated);
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

  async tryUpdateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionWithOrg | null> {
    if (!this.present(input.id)) return null;
    const updated = await this.subscriptions.updateQuantities(input);
    return this.withLicense(updated);
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

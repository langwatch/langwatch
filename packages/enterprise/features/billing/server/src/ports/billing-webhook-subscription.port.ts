// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type { Organization, Subscription } from "@langwatch/prisma-client/generated";

export type SubscriptionWithOrg = Subscription & { organization: Organization };
export type CancelledSubscription = { stripeSubscriptionId: string | null };

export abstract class BillingWebhookSubscriptionPort {
  abstract findLastNonCancelled(organizationId: string): Promise<Subscription | null>;

  abstract createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<Subscription | null>;

  abstract updateStatus(input: { id: string; status: string }): Promise<Subscription | null>;

  abstract updatePlan(input: { id: string; plan: string }): Promise<Subscription | null>;

  // --- Webhook handler methods ---

  abstract findByStripeId(stripeSubscriptionId: string): Promise<Subscription | null>;

  abstract linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }>;

  abstract activate(input: {
    id: string;
    previousStatus: string;
  }): Promise<SubscriptionWithOrg | null>;

  abstract recordPaymentFailure(input: { id: string; currentStatus: string }): Promise<void>;

  abstract cancel(input: { id: string }): Promise<void>;

  abstract cancelTrialSubscriptions(organizationId: string): Promise<void>;

  abstract migrateToSeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<CancelledSubscription[]>;

  abstract updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionWithOrg | null>;
}

export class NullBillingWebhookSubscriptionAdapter extends BillingWebhookSubscriptionPort {
  async findLastNonCancelled(_organizationId: string): Promise<Subscription | null> {
    return null;
  }

  async createPending(_input: {
    organizationId: string;
    plan: string;
  }): Promise<Subscription | null> {
    return null;
  }

  async updateStatus(_input: { id: string; status: string }): Promise<Subscription | null> {
    return null;
  }

  async updatePlan(_input: { id: string; plan: string }): Promise<Subscription | null> {
    return null;
  }

  async findByStripeId(_stripeSubscriptionId: string): Promise<Subscription | null> {
    return null;
  }

  async linkStripeId(_input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }> {
    return { count: 0 };
  }

  async activate(_input: {
    id: string;
    previousStatus: string;
  }): Promise<SubscriptionWithOrg | null> {
    return null;
  }

  async recordPaymentFailure(_input: { id: string; currentStatus: string }): Promise<void> {}

  async cancel(_input: { id: string }): Promise<void> {}

  async cancelTrialSubscriptions(_organizationId: string): Promise<void> {}

  async migrateToSeatEvent(_input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<CancelledSubscription[]> {
    return [];
  }

  async updateQuantities(_input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionWithOrg | null> {
    return null;
  }
}

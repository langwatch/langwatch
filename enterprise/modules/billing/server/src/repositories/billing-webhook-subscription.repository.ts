// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repos intentionally empty.

import type {
  BillingOrganizationRecord,
  BillingSubscriptionRecord,
} from "./subscription.repository.ts";

export type SubscriptionWithOrg = BillingSubscriptionRecord & {
  /** The trial licence a paid subscription retires. */
  organization: BillingOrganizationRecord & { license: string | null };
};
export type CancelledSubscription = { stripeSubscriptionId: string | null };

/** Outcome names the why; never collapses to null. */
export type SubscriptionMutationResult<T> =
  | { outcome: "updated"; subscription: T }
  | { outcome: "missing_subscription" };

export type ActivateSubscriptionResult =
  | { outcome: "activated"; subscription: SubscriptionWithOrg }
  | { outcome: "missing_subscription" };

export abstract class BillingWebhookSubscription {
  abstract findLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null>;

  abstract createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord>;

  abstract updateStatus(input: {
    id: string;
    status: string;
  }): Promise<SubscriptionMutationResult<BillingSubscriptionRecord>>;

  abstract updatePlan(input: {
    id: string;
    plan: string;
  }): Promise<SubscriptionMutationResult<BillingSubscriptionRecord>>;

  // --- Webhook handler methods ---

  abstract findByStripeId(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null>;

  abstract linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }>;

  abstract activate(input: {
    id: string;
    previousStatus: string;
  }): Promise<ActivateSubscriptionResult>;

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
  }): Promise<SubscriptionMutationResult<SubscriptionWithOrg>>;
}

export class NullBillingWebhookSubscriptionAdapter extends BillingWebhookSubscription {
  async findLastNonCancelled(_organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return null;
  }

  async createPending(_input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord> {
    throw new Error("NullBillingWebhookSubscriptionAdapter cannot create a subscription");
  }

  async updateStatus(_input: {
    id: string;
    status: string;
  }): Promise<SubscriptionMutationResult<BillingSubscriptionRecord>> {
    return { outcome: "missing_subscription" };
  }

  async updatePlan(_input: {
    id: string;
    plan: string;
  }): Promise<SubscriptionMutationResult<BillingSubscriptionRecord>> {
    return { outcome: "missing_subscription" };
  }

  async findByStripeId(_stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null> {
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
  }): Promise<ActivateSubscriptionResult> {
    return { outcome: "missing_subscription" };
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
  }): Promise<SubscriptionMutationResult<SubscriptionWithOrg>> {
    return { outcome: "missing_subscription" };
  }
}

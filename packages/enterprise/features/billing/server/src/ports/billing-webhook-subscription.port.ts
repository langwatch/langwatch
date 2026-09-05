// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type {
  BillingOrganizationRecord,
  BillingSubscriptionRecord,
} from "./subscription.port";

export type SubscriptionWithOrg = BillingSubscriptionRecord & {
  /** The trial licence a paid subscription retires. */
  organization: BillingOrganizationRecord & { license: string | null };
};
export type CancelledSubscription = { stripeSubscriptionId: string | null };

export abstract class BillingWebhookSubscriptionPort {
  abstract tryFindLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null>;

  abstract tryCreatePending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord | null>;

  abstract tryUpdateStatus(input: { id: string; status: string }): Promise<BillingSubscriptionRecord | null>;

  abstract tryUpdatePlan(input: { id: string; plan: string }): Promise<BillingSubscriptionRecord | null>;

  // --- Webhook handler methods ---

  abstract tryFindByStripeId(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null>;

  abstract linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }>;

  abstract tryActivate(input: {
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

  abstract tryUpdateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionWithOrg | null>;
}

export class NullBillingWebhookSubscriptionAdapter extends BillingWebhookSubscriptionPort {
  async tryFindLastNonCancelled(_organizationId: string): Promise<BillingSubscriptionRecord | null> {
    return null;
  }

  async tryCreatePending(_input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord | null> {
    return null;
  }

  async tryUpdateStatus(_input: { id: string; status: string }): Promise<BillingSubscriptionRecord | null> {
    return null;
  }

  async tryUpdatePlan(_input: { id: string; plan: string }): Promise<BillingSubscriptionRecord | null> {
    return null;
  }

  async tryFindByStripeId(_stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null> {
    return null;
  }

  async linkStripeId(_input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }> {
    return { count: 0 };
  }

  async tryActivate(_input: {
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

  async tryUpdateQuantities(_input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionWithOrg | null> {
    return null;
  }
}

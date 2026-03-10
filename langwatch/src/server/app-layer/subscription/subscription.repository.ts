import type { Organization, Subscription } from "@prisma/client";

export type SubscriptionWithOrg = Subscription & { organization: Organization };
export type CancelledSubscription = { stripeSubscriptionId: string | null };

export interface SubscriptionRepository {
  findLastNonCancelled(organizationId: string): Promise<Subscription | null>;

  createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<Subscription | null>;

  updateStatus(input: {
    id: string;
    status: string;
  }): Promise<Subscription | null>;

  updatePlan(input: {
    id: string;
    plan: string;
  }): Promise<Subscription | null>;

  // --- Webhook handler methods ---

  findByStripeId(stripeSubscriptionId: string): Promise<Subscription | null>;

  linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }>;

  activate(input: {
    id: string;
    previousStatus: string;
  }): Promise<SubscriptionWithOrg | null>;

  recordPaymentFailure(input: {
    id: string;
    currentStatus: string;
  }): Promise<void>;

  cancel(input: { id: string }): Promise<void>;

  cancelTrialSubscriptions(organizationId: string): Promise<void>;

  migrateToSeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<CancelledSubscription[]>;

  updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionWithOrg | null>;
}

export class NullSubscriptionRepository implements SubscriptionRepository {
  async findLastNonCancelled(
    _organizationId: string,
  ): Promise<Subscription | null> {
    return null;
  }

  async createPending(_input: {
    organizationId: string;
    plan: string;
  }): Promise<Subscription | null> {
    return null;
  }

  async updateStatus(_input: {
    id: string;
    status: string;
  }): Promise<Subscription | null> {
    return null;
  }

  async updatePlan(_input: {
    id: string;
    plan: string;
  }): Promise<Subscription | null> {
    return null;
  }

  async findByStripeId(
    _stripeSubscriptionId: string,
  ): Promise<Subscription | null> {
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

  async recordPaymentFailure(_input: {
    id: string;
    currentStatus: string;
  }): Promise<void> {}

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

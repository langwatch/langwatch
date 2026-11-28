// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repos intentionally empty.

import type {
  BillingSubscriptionRecord,
  BillingSubscriptionWithOrganization,
  LiveUnlinkedSubscription,
  SupersededSubscription,
} from "./subscription.repository.ts";

export type SubscriptionWithOrg = BillingSubscriptionWithOrganization;

/** Outcome names the why; never collapses to null. */
export type SubscriptionMutationResult<T> =
  | { outcome: "updated"; subscription: T }
  | { outcome: "missing_subscription" };

export type ActivateSubscriptionResult =
  | { outcome: "activated"; subscription: SubscriptionWithOrg }
  | { outcome: "missing_subscription" };

export abstract class BillingWebhookSubscriptionRepository {
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

  abstract findSupersededBySeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<SupersededSubscription[]>;

  abstract findLiveUnlinkedBeside(input: {
    pendingId: string;
  }): Promise<LiveUnlinkedSubscription[]>;

  abstract findLiveLinkedBeside(input: { pendingId: string }): Promise<BillingSubscriptionRecord[]>;

  abstract adoptCheckout(input: {
    pendingId: string;
    liveId: string;
    stripeSubscriptionId: string;
  }): Promise<void>;

  /** Cancels the row only while its checkout is still PENDING; answers the rows it cancelled. */
  abstract cancelPendingCheckout(input: { id: string }): Promise<BillingSubscriptionRecord[]>;

  abstract updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    /** Undefined leaves the stored cap alone: only a seat-priced subscription states it. */
    maxMembersDeveloper?: number;
    maxMessagesPerMonth: number | null;
  }): Promise<SubscriptionMutationResult<SubscriptionWithOrg>>;
}

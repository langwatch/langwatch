import type { Instant } from "@langwatch/time";
export type BillingSubscriptionRecord = {
  id: string;
  organizationId: string;
  status: string;
  plan: string;
  stripeSubscriptionId: string | null;
  createdAt: Instant;
  startDate: Instant | null;
  endDate: Instant | null;
  maxMembers: number | null;
  maxMembersLite: number | null;
  maxMembersDeveloper: number | null;
  maxMessagesPerMonth: number | null;
  lastPaymentFailedDate: Instant | null;
  /** Seats a decrease leaves usable until `seatsKeptUntil`, the end of the period paid for. */
  seatsKept: number | null;
  seatsKeptUntil: Instant | null;
  /** The retention the checkout was bought with; absent when it offered no choice. */
  maxRetentionDays?: number | null;
  /** An open failed payment recovery case: its invoice, day 0, and the last notice sent. */
  paymentRecoveryInvoiceId?: string | null;
  paymentRecoveryStartedAt?: Instant | null;
  paymentRecoveryNoticeDay?: number | null;
  /** The over-plan mark: open while `overPlanSince` is set and `overPlanEndedAt` is not. */
  overPlanSince?: Instant | null;
  overPlanEndedAt?: Instant | null;
};

/** An operator's live row with no provider link, and whether it is a custom deal (isCustomDeal). */
export type LiveUnlinkedSubscription = BillingSubscriptionRecord & {
  /** An operator set a limit beyond seats on it. */
  customLimits: boolean;
};

type BillingOrganizationRecord = {
  id: string;
  name: string;
  stripeCustomerId: string | null;
};

/** A tiered subscription a Growth seat subscription replaces; ours may already say cancelled. */
export type SupersededSubscription = {
  id: string;
  stripeSubscriptionId: string;
  cancelledInRecords: boolean;
};

export type BillingSubscriptionWithOrganization = BillingSubscriptionRecord & {
  organization: BillingOrganizationRecord;
};

export abstract class BillingSubscriptionRepository {
  abstract findActive(organizationId: string): Promise<BillingSubscriptionRecord | null>;
  abstract findLastNonCancelled(organizationId: string): Promise<BillingSubscriptionRecord | null>;
  /** Whether the organization holds any subscription row, cancelled ones included. */
  abstract hasAnyForOrganization(organizationId: string): Promise<boolean>;
  abstract createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord>;
  abstract updateStatus(input: { id: string; status: string }): Promise<BillingSubscriptionRecord>;
  abstract updatePlan(input: { id: string; plan: string }): Promise<BillingSubscriptionRecord>;
  abstract findByStripeId(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null>;
  abstract linkStripeId(input: {
    id: string;
    stripeSubscriptionId: string;
  }): Promise<{ count: number }>;
  abstract activate(input: {
    id: string;
    previousStatus: string;
  }): Promise<BillingSubscriptionWithOrganization>;
  abstract recordPaymentFailure(input: { id: string; currentStatus: string }): Promise<void>;
  abstract cancel(input: { id: string }): Promise<void>;
  abstract cancelTrialSubscriptions(organizationId: string): Promise<void>;
  /** Every tiered subscription with a Stripe id that a Growth seat one replaces, cancelled too. */
  abstract findSupersededBySeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<SupersededSubscription[]>;
  /** The ACTIVE rows with no provider link in the checkout row's organization, the row excluded. */
  abstract findLiveUnlinkedBeside(input: {
    pendingId: string;
  }): Promise<LiveUnlinkedSubscription[]>;
  /** The checkout row's organization's other ACTIVE non-tiered rows linked to Stripe. */
  abstract findLiveLinkedBeside(input: { pendingId: string }): Promise<BillingSubscriptionRecord[]>;
  /**
   * The live row takes the checkout's plan, seats and retention, and the checkout row is
   * cancelled, in one step: a paid checkout lands on the plan the organization already has.
   */
  abstract adoptCheckout(input: { pendingId: string; liveId: string }): Promise<void>;
  /** Cancels the row only while its checkout is still PENDING; answers the rows it cancelled. */
  abstract cancelPendingCheckout(input: { id: string }): Promise<BillingSubscriptionRecord[]>;
  abstract updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    /** Undefined leaves the stored cap alone: only a seat-priced subscription states it. */
    maxMembersDeveloper?: number;
    maxMessagesPerMonth: number | null;
  }): Promise<BillingSubscriptionWithOrganization>;
}

export type BillingSubscriptionRecord = {
  id: string;
  organizationId: string;
  status: string;
  plan: string;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  startDate: Date | null;
  endDate: Date | null;
  maxMembers: number | null;
  maxMembersLite: number | null;
  maxMessagesPerMonth: number | null;
  lastPaymentFailedDate: Date | null;
};

export type BillingOrganizationRecord = {
  id: string;
  name: string;
  stripeCustomerId: string | null;
};

export type BillingSubscriptionWithOrganization = BillingSubscriptionRecord & {
  organization: BillingOrganizationRecord;
};

export abstract class BillingSubscriptionRepository {
  abstract tryFindActive(organizationId: string): Promise<BillingSubscriptionRecord | null>;
  abstract tryFindLastNonCancelled(
    organizationId: string,
  ): Promise<BillingSubscriptionRecord | null>;
  abstract createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<BillingSubscriptionRecord>;
  abstract updateStatus(input: { id: string; status: string }): Promise<BillingSubscriptionRecord>;
  abstract updatePlan(input: { id: string; plan: string }): Promise<BillingSubscriptionRecord>;
  abstract tryFindByStripeId(
    stripeSubscriptionId: string,
  ): Promise<BillingSubscriptionRecord | null>;
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
  abstract migrateToSeatEvent(input: {
    organizationId: string;
    excludeSubscriptionId: string;
  }): Promise<Array<{ stripeSubscriptionId: string | null }>>;
  abstract updateQuantities(input: {
    id: string;
    maxMembers: number | null;
    maxMessagesPerMonth: number | null;
  }): Promise<BillingSubscriptionWithOrganization>;
}

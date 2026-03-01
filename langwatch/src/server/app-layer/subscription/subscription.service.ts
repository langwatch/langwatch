import type {
  Currency,
  OrganizationUserRole,
  Subscription,
} from "@prisma/client";
export type BillingInterval = "monthly" | "annual";

/**
 * Manages Stripe subscription lifecycle -- creating checkouts, updating items,
 * cancelling, billing portal. Answers: "how do we change what this organization pays for?"
 *
 * Plan/limit resolution ("what can this organization do?") lives in `PlanProvider`
 * (`src/server/app-layer/subscription/plan-provider.ts`), accessed via `getApp().planProvider`.
 */
export interface SubscriptionService {
  updateSubscriptionItems(params: {
    organizationId: string;
    plan: string;
    upgradeMembers: boolean;
    upgradeTraces: boolean;
    totalMembers: number;
    totalTraces: number;
  }): Promise<{ success: boolean }>;

  createOrUpdateSubscription(params: {
    organizationId: string;
    baseUrl: string;
    plan: string;
    membersToAdd?: number;
    tracesToAdd?: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: BillingInterval;
  }): Promise<{ url: string | null }>;

  createBillingPortalSession(params: {
    customerId: string;
    baseUrl: string;
    organizationId: string;
  }): Promise<{ url: string }>;

  getLastNonCancelledSubscription(
    organizationId: string,
  ): Promise<Subscription | null>;

  previewProration(params: {
    organizationId: string;
    newTotalSeats: number;
  }): Promise<{
    formattedAmountDue: string;
    formattedRecurringTotal: string;
    billingInterval: string;
  }>;

  notifyProspective(params: {
    organizationId: string;
    plan: string;
    customerName?: string;
    customerEmail?: string;
    note?: string;
    actorEmail: string;
  }): Promise<{ success: boolean }>;

  createSubscriptionWithInvites(params: {
    organizationId: string;
    baseUrl: string;
    membersToAdd: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: BillingInterval;
    invites: Array<{ email: string; role: OrganizationUserRole }>;
  }): Promise<{ url: string | null }>;
}

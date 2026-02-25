import type {
  Currency,
  OrganizationUserRole,
  Subscription,
} from "@prisma/client";
import { SubscriptionServiceUnavailableError } from "./errors";

export type BillingInterval = "monthly" | "annual";

/**
 * Manages Stripe subscription lifecycle -- creating checkouts, updating items,
 * cancelling, billing portal. Answers: "how do we change what this organization pays for?"
 *
 * NOT to be confused with `SubscriptionHandler` (at `src/server/subscriptionHandler.ts`)
 * which resolves plan limits (`getActivePlan`) and answers: "what can this organization do?"
 * These are separate concerns with separate refactor paths.
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

/**
 * Null implementation for self-hosted deployments.
 * - Read/query methods return empty/null (safe defaults).
 * - Stripe-dependent mutations throw SubscriptionServiceUnavailableError.
 * - Notifications silently return { success: false }.
 */
export class NullSubscriptionService implements SubscriptionService {
  async getLastNonCancelledSubscription(
    _organizationId: string,
  ): Promise<Subscription | null> {
    return null;
  }

  async updateSubscriptionItems(_params: {
    organizationId: string;
    plan: string;
    upgradeMembers: boolean;
    upgradeTraces: boolean;
    totalMembers: number;
    totalTraces: number;
  }): Promise<{ success: boolean }> {
    throw new SubscriptionServiceUnavailableError();
  }

  async createOrUpdateSubscription(_params: {
    organizationId: string;
    baseUrl: string;
    plan: string;
    membersToAdd?: number;
    tracesToAdd?: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: BillingInterval;
  }): Promise<{ url: string | null }> {
    throw new SubscriptionServiceUnavailableError();
  }

  async createBillingPortalSession(_params: {
    customerId: string;
    baseUrl: string;
    organizationId: string;
  }): Promise<{ url: string }> {
    throw new SubscriptionServiceUnavailableError();
  }

  async previewProration(_params: {
    organizationId: string;
    newTotalSeats: number;
  }): Promise<{
    formattedAmountDue: string;
    formattedRecurringTotal: string;
    billingInterval: string;
  }> {
    throw new SubscriptionServiceUnavailableError();
  }

  async createSubscriptionWithInvites(_params: {
    organizationId: string;
    baseUrl: string;
    membersToAdd: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: BillingInterval;
    invites: Array<{ email: string; role: OrganizationUserRole }>;
  }): Promise<{ url: string | null }> {
    throw new SubscriptionServiceUnavailableError();
  }

  async notifyProspective(_params: {
    organizationId: string;
    plan: string;
    customerName?: string;
    customerEmail?: string;
    note?: string;
    actorEmail: string;
  }): Promise<{ success: boolean }> {
    return { success: false };
  }
}

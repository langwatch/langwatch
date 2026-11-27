// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { moduleApi } from "@langwatch/module";

import type {
  BillingPricingModel,
  ResourceLimitNotifierInput,
  SubscriptionPlanInput,
} from "./billing-types.ts";
import type { BlockedSeatChangeAttempt } from "./blocked-seat-change.ts";
import type {
  ConnectedAddCommitRequest,
  ConnectedBillingAccountView,
  ConnectedBillingOverview,
  ConnectedCreditGrantView,
  ConnectedOnboardRequest,
  ConnectedRenewRequest,
} from "./connected-billing.schemas.ts";
import type { RenewalCompletion } from "./connected-billing.ts";
import type { RetentionStorageOutcome, RetentionStorageReport } from "./growth-seat-event.ts";
import type { Currency } from "./pricing.ts";
import type { SeatPayment, SeatPaymentStatus, SeatPurchase } from "./seat-purchase.ts";
import type { SubscriptionBillingInterval } from "./subscription.trpc.ts";

/**
 * The staff member the platform door admitted for an admin console command: the
 * impersonator where one is borrowing a customer's session.
 */
export type BillingStaff = Readonly<{ id: string; email?: string | null | undefined }>;

/**
 * What the billing module answers other modules: invoice billing for a
 * connected self-hosted customer (ADR-156 section 7). Every operation refuses
 * off LangWatch Cloud, and where no payment provider is configured. The
 * admin console operations trust the platform door (Q43): staff only, writes need ops:manage.
 */
export interface BillingApi {
  /** The commercial state of one connected customer. */
  getConnectedBillingOverview(
    input: { organizationId: string },
    staff: BillingStaff,
  ): Promise<ConnectedBillingOverview>;
  /** Onboards a customer, or completes an onboarding that stopped halfway. */
  onboardConnectedCustomer(
    input: ConnectedOnboardRequest,
    staff: BillingStaff,
  ): Promise<ConnectedBillingAccountView>;
  /** Raises the commit mid-term: a second paid credit, and the budget with it. */
  addConnectedCommit(
    input: ConnectedAddCommitRequest,
    staff: BillingStaff,
  ): Promise<ConnectedCreditGrantView>;
  renewConnectedTerm(
    input: ConnectedRenewRequest,
    staff: BillingStaff,
  ): Promise<ConnectedBillingAccountView>;
  completeConnectedRenewalIfDue(
    input: { organizationId: string },
    staff: BillingStaff,
  ): Promise<RenewalCompletion>;
  /** Finance received the money outside the payment provider. */
  markConnectedInvoicePaidOutOfBand(
    input: { stripeInvoiceId: string },
    staff: BillingStaff,
  ): Promise<void>;
  /**
   * One seat invoicing pass: decides every seat change licensing recorded that
   * has no decision yet, then invoices every intended one. Cloud only.
   */
  invoicePendingSeatChanges(): Promise<void>;
  /** The daily tick: monthly statements and due renewals. Cloud only. */
  runConnectedBillingTick(): Promise<void>;
  /**
   * The plan an organization's active subscription grants on LangWatch Cloud, with the
   * subscription's own limit overrides; the free plan where none is active or off Cloud.
   */
  getActiveSubscriptionPlan(input: SubscriptionPlanInput): Promise<PlanInfo>;
  /**
   * Main's `usageLimits.notifyResourceLimitReached`: the ops Slack alert for a reached seat limit,
   * SaaS only, at most once a day per organization and limit. Never throws.
   */
  notifyResourceLimitReached(input: ResourceLimitNotifierInput): Promise<void>;
  /**
   * Tells sales that a person waits for a seat in an organization whose plan only sales can grow,
   * on the subscriptions Slack channel. SaaS only; the caller sends it once per request. Never
   * throws: `sent` is false when it did not go out, so the caller can let a later ask retry it.
   */
  notifySalesOfSeatRequest(input: {
    organizationId: string;
    organizationName: string;
    plan: string;
    seats: number;
    requestedSeats: number;
  }): Promise<{ sent: boolean }>;
  /** The organization's pricing model column, which is empty for organizations never migrated. */
  getPricingModel(input: {
    organizationId: string;
  }): Promise<{ pricingModel: BillingPricingModel | null }>;
  /**
   * Opens a seat checkout for `membersToAdd`, the customer resolved from `customerEmail`. Answers
   * the pending subscription organization holds the checkout's invitations against (C2 A).
   */
  createSeatCheckout(input: {
    organizationId: string;
    baseUrl: string;
    membersToAdd: number;
    currency?: Currency;
    billingInterval?: SubscriptionBillingInterval;
    customerEmail: string | null;
    retentionDays?: number;
  }): Promise<{ url: string | null; subscriptionId: string }>;
  /**
   * Keeps a seat change refused with `subscription_ambiguous` for the admin who tried; once the
   * organization is back on one subscription that admin gets one email to finish it. `seats`:
   * the seats the change needs beyond today's. Never throws.
   */
  recordBlockedSeatChange(input: {
    organizationId: string;
    userId: string;
    attempt: BlockedSeatChangeAttempt;
    seats: number;
  }): Promise<void>;
  /**
   * Bills the storage an organization keeps beyond the 90 days Growth includes: the metered line
   * follows the longest retention, and a measurement goes to the meter as that day's share of a
   * GB-month. Answers what it did; an organization with no Growth seat subscription is skipped.
   */
  recordRetentionStorage(input: RetentionStorageReport): Promise<RetentionStorageOutcome>;
  /**
   * Adds one full seat for a role change: charged to the subscription's payment method, or a
   * payment page (the seat invoice, or a seat checkout) when the customer must act first.
   * `successPath` is where a checkout returns. Refuses `subscription_ambiguous` untouched.
   */
  addFullSeat(input: {
    organizationId: string;
    quotedAt?: number;
    baseUrl: string;
    successPath: string;
    customerEmail: string | null;
  }): Promise<SeatPurchase>;
  /** Whether a seat payment is paid, still open, or over; a paid one has its seat recorded. */
  settleSeatPayment(input: {
    organizationId: string;
    payment: SeatPayment;
  }): Promise<{ status: SeatPaymentStatus }>;
}

export const BillingApi = moduleApi<BillingApi>()("billing");

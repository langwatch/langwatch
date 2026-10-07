// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { moduleApi, uiTokens } from "@langwatch/module";
import type { Instant } from "@langwatch/time";

import type {
  BillingPricingModel,
  ResourceLimitNotifierInput,
  SubscriptionPlanInput,
  UsageWarningDecision,
} from "./billing-types.ts";
import type {
  ConnectedAddCommitRequest,
  ConnectedBillingAccountView,
  ConnectedBillingOverview,
  ConnectedCreditGrantView,
  ConnectedOnboardRequest,
  ConnectedRenewRequest,
} from "./connected-billing.schemas.ts";
import type { RenewalCompletion } from "./connected-billing.ts";

/**
 * The staff member the platform door admitted for a backoffice command: the
 * impersonator where one is borrowing a customer's session.
 */
export type BillingStaff = Readonly<{ id: string; email?: string | null | undefined }>;

/**
 * What the billing module answers other modules: invoice billing for a
 * connected self-hosted customer (ADR-156 section 7). Every operation refuses
 * off LangWatch Cloud, and where no payment provider is configured. The
 * backoffice operations trust the platform door (Q43): staff only, writes need ops:manage.
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
   * Mails the organization's admins the usage warning entitlement decided, once per threshold a
   * month. Billing counts nothing: the threshold and per-project counts arrive decided.
   */
  sendUsageWarning(
    input: UsageWarningDecision,
  ): Promise<{ sent: boolean; notificationId?: string; sentAt?: Instant }>;
  /**
   * Main's `usageLimits.notifyResourceLimitReached`: the ops Slack alert for a reached seat limit,
   * SaaS only, at most once a day per organization and limit. Never throws.
   */
  notifyResourceLimitReached(input: ResourceLimitNotifierInput): Promise<void>;
  /** The organization's pricing model column, which is empty for organizations never migrated. */
  getPricingModel(input: {
    organizationId: string;
  }): Promise<{ pricingModel: BillingPricingModel | null }>;
}

export const BillingApi = moduleApi<BillingApi>()("billing");

/** What billing lends to screens it does not own: a core screen renders it directly (§11). */

/** The "need more?" card. It reads the plan itself and takes nothing. */
export type ContactSalesProps = Record<string, never>;

/** A seat change waiting in licensing's upgrade dialog; billing prices and confirms it. */
export type SeatProrationPreviewProps = {
  variant: {
    organizationId: string;
    currentSeats: number;
    newSeats: number;
    /** `quotedAt` is the instant the quote on screen was priced, when one loaded. */
    onConfirm: (quotedAt?: number) => Promise<void>;
  };
  open: boolean;
  onClose: () => void;
};

export const ContactSalesToken = uiTokens("billing").component<ContactSalesProps>("contactSales");
export const SeatProrationPreviewToken =
  uiTokens("billing").component<SeatProrationPreviewProps>("seatProrationPreview");

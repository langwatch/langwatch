// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import type { Instant } from "@langwatch/time";

import type { BillingPricingModel, SubscriptionPlanInput, USAGE_UNKNOWN } from "./billing-types.ts";
import type {
  ConnectedAddCommitRequest,
  ConnectedBillingAccountView,
  ConnectedBillingOverview,
  ConnectedCreditGrantView,
  ConnectedOnboardRequest,
  ConnectedRenewRequest,
} from "./connected-billing.schemas.ts";
import type { RenewalCompletion, SeatChangeBillingOutcome } from "./connected-billing.ts";

/**
 * The staff member a backoffice command is checked against: the impersonator
 * where one is borrowing a customer's session. `null` is nobody signed in.
 */
export type BillingStaff = Readonly<{ id: string; email?: string | null | undefined }>;

/** A scenario somebody wrote, and how many the project holds now. */
export type ScenarioCreatedSignal = Readonly<{
  userId: string;
  projectId: string;
  scenarioId: string;
  scenarioCount: number;
}>;

/**
 * What the billing module answers other modules: invoice billing for a
 * connected self-hosted customer (ADR-156 section 7). Every operation refuses
 * off LangWatch Cloud, and where no payment provider is configured. The
 * backoffice operations answer anyone off the operator staff list not found.
 */
export interface BillingApi {
  /** The commercial state of one connected customer. */
  getConnectedBillingOverview(
    input: { organizationId: string },
    by: BillingStaff | null,
  ): Promise<ConnectedBillingOverview>;
  /** Onboards a customer, or completes an onboarding that stopped halfway. */
  onboardConnectedCustomer(
    input: ConnectedOnboardRequest,
    by: BillingStaff | null,
  ): Promise<ConnectedBillingAccountView>;
  /** Raises the commit mid-term: a second paid credit, and the budget with it. */
  addConnectedCommit(
    input: ConnectedAddCommitRequest,
    by: BillingStaff | null,
  ): Promise<ConnectedCreditGrantView>;
  renewConnectedTerm(
    input: ConnectedRenewRequest,
    by: BillingStaff | null,
  ): Promise<ConnectedBillingAccountView>;
  completeConnectedRenewalIfDue(
    input: { organizationId: string },
    by: BillingStaff | null,
  ): Promise<RenewalCompletion>;
  /** Finance received the money outside the payment provider. */
  markConnectedInvoicePaidOutOfBand(
    input: { stripeInvoiceId: string },
    by: BillingStaff | null,
  ): Promise<void>;
  /** Invoices the seats a mid-term license change added. */
  invoiceAddedSeats(input: {
    organizationId: string;
    licenseRowId: string;
    previousSeats: number;
    seats: number;
  }): Promise<SeatChangeBillingOutcome>;
  /** The daily tick: pending seat invoices, monthly statements, due renewals. Cloud only. */
  runConnectedBillingTick(): Promise<void>;
  /**
   * The `scenario_created` product event, tagged with the onboarding the
   * organization went through, and the nurturing count behind it.
   */
  recordScenarioCreated(input: ScenarioCreatedSignal): Promise<void>;
  /**
   * The plan an organization's active subscription grants on LangWatch Cloud, with the
   * subscription's own limit overrides; the free plan where none is active or off Cloud.
   */
  getActiveSubscriptionPlan(input: SubscriptionPlanInput): Promise<PlanInfo>;
  /**
   * This UTC billing month's approximate billable events per named project, 0 where a project
   * has none; unknown when no analytics store is composed. Main's `EventUsageService`.
   */
  countBillableEventsByProjects(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<{ projectId: string; count: number }[] | typeof USAGE_UNKNOWN>;
  /**
   * Main's `usageLimits.checkAndSendWarning`: mails the organization's admins when usage crosses a
   * warning threshold not yet warned about this month, counting projects in the caller's meter.
   */
  checkAndSendUsageWarning(input: {
    organizationId: string;
    currentMonthMessagesCount: number;
    maxMonthlyUsageLimit: number;
    meter: "traces" | "events";
  }): Promise<{ sent: boolean; notificationId?: string; sentAt?: Instant }>;
  /** The organization's pricing model column, which is empty for organizations never migrated. */
  getPricingModel(input: {
    organizationId: string;
  }): Promise<{ pricingModel: BillingPricingModel | null }>;
}

export const BillingApi = moduleApi<BillingApi>()("billing");

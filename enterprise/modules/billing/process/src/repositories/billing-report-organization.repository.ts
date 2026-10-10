// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { UsageBillingContract } from "@langwatch/enterprise-billing-contract";

/**
 * The organization as the monthly roll-up needs to see it: whether it is
 * billed for usage at all, whether it has a Stripe customer, whether a live
 * subscription stands behind it, and which contract invoices it.
 */
export type BillingReportOrganization = {
  id: string;
  stripeCustomerId: string | null;
  subscriptions: { id: string }[];
  /** Which of the two contracts invoices this organization's hosted usage. */
  contract: UsageBillingContract;
};

/**
 * Why the lookup did or did not yield an organization: "no such organization"
 * is an anomaly worth a warning, "does not buy usage" is every free plan's
 * ordinary state, and a null would give both one severity.
 */
export type BillingReportOrganizationLookup =
  | { outcome: "usage_billed"; organization: BillingReportOrganization }
  | { outcome: "not_found" }
  | { outcome: "not_usage_billed" };

/**
 * The one organization read the monthly roll-up makes — three facts, so
 * Billing takes no dependency on a whole organization service.
 */
export abstract class BillingReportOrganizationRepository {
  abstract getOrganizationForBilling(
    organizationId: string,
  ): Promise<BillingReportOrganizationLookup>;
}

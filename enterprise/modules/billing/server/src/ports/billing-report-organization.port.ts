// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The organization as the monthly roll-up needs to see it: whether it is
 * billed per event at all, whether it has a Stripe customer, and whether a
 * live seat-event subscription stands behind it.
 */
export type BillingReportOrganization = {
  id: string;
  stripeCustomerId: string | null;
  subscriptions: { id: string }[];
};

/**
 * Why the billing lookup did or did not yield an organization.
 *
 * A nullable return cannot carry this: "there is no such organization" is an
 * anomaly worth a warning, and "this organization does not buy usage" is the
 * ordinary state of every free and legacy plan. Collapsing both into `null`
 * left the caller with one branch and therefore one severity, so the routine
 * case was reported at the anomaly's.
 */
export type BillingReportOrganizationLookup =
  | { outcome: "usage_billed"; organization: BillingReportOrganization }
  | { outcome: "not_found" }
  | { outcome: "not_usage_billed" };

/**
 * The one organization read the monthly roll-up makes.
 *
 * Deliberately narrow: reporting a month's usage needs three facts and no
 * others, so Billing does not take a dependency on a whole organization
 * service to answer them. The outcome says WHY there is nothing to report, so
 * the command can skip the month at the severity the reason deserves.
 *
 * Named for the question rather than a repository verb, because this port IS
 * the reader the `reportUsageForMonth` command declares; a second spelling in
 * front of it would be a pass-through with nothing to say.
 */
export abstract class BillingReportOrganizationPort {
  abstract getOrganizationForBilling(
    organizationId: string,
  ): Promise<BillingReportOrganizationLookup>;
}

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
 * The one organization read the monthly roll-up makes.
 *
 * Deliberately narrow: reporting a month's usage needs three facts and no
 * others, so Billing does not take a dependency on a whole organization
 * service to answer them. Null means "do not report" rather than "not found" —
 * an organization on another pricing model has no meter event to send, and the
 * command skips the month instead of inventing one.
 *
 * Named for the question rather than a repository verb, because this port IS
 * the reader the `reportUsageForMonth` command declares; a second spelling in
 * front of it would be a pass-through with nothing to say.
 */
export abstract class BillingReportOrganizationPort {
  abstract getOrganizationForBilling(
    organizationId: string,
  ): Promise<BillingReportOrganization | null>;
}

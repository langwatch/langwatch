// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  BillingReportOrganization,
  BillingReportOrganizationLookup,
} from "../repositories/billing-report-organization.repository.ts";

/** Why the meter does not bill an organization; each is logged at its own severity. */
export type NotUsageBilledReason =
  | "not_found"
  | "not_usage_priced"
  | "no_stripe_customer"
  | "no_active_subscription";

type UsageBilledVerdict =
  | { usageBilled: true; organization: BillingReportOrganization & { stripeCustomerId: string } }
  | { usageBilled: false; reason: NotUsageBilledReason };

/**
 * The meter's one rule for whether it bills an organization: usage pricing, a Stripe customer and
 * an active subscription, or a connected self-hosted account with its usage subscription. The
 * monthly report and the usage-billing fact read it alike (ADR-174 decision 12).
 */
export function usageBilledOf({
  lookup,
}: {
  lookup: BillingReportOrganizationLookup;
}): UsageBilledVerdict {
  if (lookup.outcome === "not_found") return { usageBilled: false, reason: "not_found" };
  if (lookup.outcome === "not_usage_billed") {
    return { usageBilled: false, reason: "not_usage_priced" };
  }
  const { organization } = lookup;
  const { stripeCustomerId } = organization;
  if (!stripeCustomerId) return { usageBilled: false, reason: "no_stripe_customer" };
  if (organization.subscriptions.length === 0) {
    return { usageBilled: false, reason: "no_active_subscription" };
  }
  return { usageBilled: true, organization: { ...organization, stripeCustomerId } };
}

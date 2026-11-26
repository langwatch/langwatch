/**
 * The currency Strict's price is quoted in: the subscription's, which its Growth plan type names.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { PrivacyBillingCurrency } from "./data-privacy-host.ts";

/** Billing writes a Growth plan in the currency Stripe holds the customer in at checkout. */
const EURO_GROWTH_PLAN = /^GROWTH_SEAT_EUR_/;

/** On Cloud, for a reader who may view the organization's plan. */
export function mayReadSubscriptionPlan({
  isSaaS,
  organizationId,
  canViewOrganization,
}: {
  isSaaS: boolean;
  organizationId: string | undefined;
  canViewOrganization: boolean;
}): boolean {
  return isSaaS && !!organizationId && canViewOrganization;
}

/** Euros for a euro Growth plan; dollars for any other, and for a plan unread or unreadable. */
export function billingCurrencyOf({
  mayRead,
  plan,
}: {
  mayRead: boolean;
  plan: { isLoading: boolean; isError: boolean; data: { type: string } | undefined };
}): PrivacyBillingCurrency {
  if (!mayRead || plan.isLoading || plan.isError || !plan.data) return "USD";
  return EURO_GROWTH_PLAN.test(plan.data.type) ? "EUR" : "USD";
}

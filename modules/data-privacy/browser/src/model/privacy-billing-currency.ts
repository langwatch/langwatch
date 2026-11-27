/**
 * The currency Strict's price is quoted in: the subscription's, which its Growth plan type names.
 * Display only; the charge follows the Stripe subscription (ADR-201 decision 11).
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import { parseGrowthSeatPlanType } from "@langwatch/enterprise-billing-contract";

import type { PrivacyBillingCurrencyReading } from "./data-privacy-host.ts";

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

/**
 * Euros for a euro Growth plan, dollars for any other; "loading" while the first read is in
 * flight, "unknown" once it failed with no plan. A refresh that fails keeps the last answer, so a
 * passing read error never takes the price away.
 */
export function billingCurrencyOf({
  mayRead,
  plan,
}: {
  mayRead: boolean;
  plan: { isLoading?: boolean; data: { type: string } | undefined };
}): PrivacyBillingCurrencyReading {
  if (!mayRead) return "USD";
  if (!plan.data) return plan.isLoading ? "loading" : "unknown";
  return parseGrowthSeatPlanType(plan.data.type)?.currency === "EUR" ? "EUR" : "USD";
}

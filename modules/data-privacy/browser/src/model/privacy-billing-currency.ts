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

/** Euros for a euro Growth plan, loading while it loads; dollars for any other or unreadable. */
export function billingCurrencyOf({
  mayRead,
  plan,
}: {
  mayRead: boolean;
  plan: { isLoading: boolean; isError: boolean; data: { type: string } | undefined };
}): PrivacyBillingCurrencyReading {
  if (!mayRead) return "USD";
  if (plan.isLoading) return "loading";
  if (plan.isError || !plan.data) return "USD";
  return parseGrowthSeatPlanType(plan.data.type)?.currency === "EUR" ? "EUR" : "USD";
}

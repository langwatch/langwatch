// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Billing's ops reads' pure decisions: stored plan, state and tax values to their codes, an
 * unknown one to `other`, and which subscription an organization is billed under now.
 * Spec: modules/staff-access/specs/staff-access-functions-billing.feature
 */

import {
  PlanTypes,
  STRIPE_PRICE_NAMES,
  type BillingFactPlan,
  type BillingFactState,
  type BillingPriceTaxBehavior,
  type OrganizationBillingFacts,
  type StripePriceName,
} from "@langwatch/enterprise-billing-contract";

const PLANS: readonly string[] = Object.values(PlanTypes);
const STATES: Readonly<Record<string, BillingFactState>> = {
  PENDING: "pending",
  FAILED: "failed",
  ACTIVE: "active",
  CANCELLED: "cancelled",
};
const TAX_BEHAVIORS: readonly string[] = ["exclusive", "inclusive", "unspecified"];
const PRICE_NAMES: readonly string[] = STRIPE_PRICE_NAMES;
/** Active rows first, cancelled last; every other state sits between. */
const BILLING_RANK: Readonly<Record<string, number>> = { ACTIVE: 0, CANCELLED: 2 };

export function factPlanOf(plan: string): BillingFactPlan {
  return PLANS.includes(plan) ? (plan as BillingFactPlan) : "other";
}

export function factStateOf(status: string): BillingFactState {
  return STATES[status] ?? "other";
}

export function taxBehaviorOf(value: string): BillingPriceTaxBehavior {
  return TAX_BEHAVIORS.includes(value) ? (value as BillingPriceTaxBehavior) : "other";
}

export function pricingModelCodeOf(model: string | null): OrganizationBillingFacts["pricingModel"] {
  if (model === "SEAT_EVENT") return "seat_event";
  if (model === "TIERED") return "tiered";
  return "none";
}

export function catalogueNameOf(lookupKey: string | null): StripePriceName | "other" {
  return lookupKey !== null && PRICE_NAMES.includes(lookupKey)
    ? (lookupKey as StripePriceName)
    : "other";
}

/**
 * The rows in the order billing bills under them, newest first within each: active, then open,
 * then cancelled. The first is the subscription the organization is billed under now.
 */
export function billingOrderOf<Row extends { status: string }>(newestFirst: readonly Row[]): Row[] {
  const rank = (row: Row) => BILLING_RANK[row.status] ?? 1;
  return newestFirst.toSorted((a, b) => rank(a) - rank(b));
}

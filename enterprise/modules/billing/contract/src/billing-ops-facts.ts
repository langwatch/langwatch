// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What billing answers an ops read (ADR-202, amendment 2026-11-25): ids, plan and state codes,
 * counts and epoch-millisecond times. No card, invoice link, customer name or Stripe key.
 * Spec: modules/staff-access/specs/staff-access-functions-billing.feature
 */

import type { PlanTypes } from "./plan-types.ts";
import type { StripePriceName } from "./stripe-prices.ts";

/** A subscription row's status, lowercased; a value billing does not know reads `other`. */
export type BillingFactState = "pending" | "failed" | "active" | "cancelled" | "other";
/** A stored plan code; one billing does not know reads `other`. */
export type BillingFactPlan = PlanTypes | "other";

/** The subscription an organization is billed under now: active, else the newest open, else the newest. */
export type BillingFactSubscription = Readonly<{
  subscriptionId: string;
  plan: BillingFactPlan;
  state: BillingFactState;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  lastPaymentFailedAt: number | null;
  linkedToStripe: boolean;
  fullSeats: number | null;
  liteSeats: number | null;
  developerSeats: number | null;
  eventsCap: number | null;
  retentionDays: number | null;
  seatsKept: number | null;
  seatsKeptUntil: number | null;
  /** An open failed payment recovery case: day 0, and the last notice day sent. */
  paymentRecoveryStartedAt: number | null;
  paymentRecoveryNoticeDay: number | null;
}>;

export type OrganizationBillingFacts = Readonly<{
  organizationId: string;
  pricingModel: "tiered" | "seat_event" | "none";
  current: BillingFactSubscription | null;
  subscriptionsByState: readonly Readonly<{ state: BillingFactState; count: number }>[];
  lastCancelledAt: number | null;
  /** The open over-plan mark on a Free organization, when one is open. */
  overPlanSince: number | null;
}>;

/** Subscriptions created in a range, for one plan and state. */
export type BillingSubscriptionCount = Readonly<{
  plan: BillingFactPlan;
  state: BillingFactState;
  subscriptions: number;
  /** How many of them were activated: the checkout completed. */
  activated: number;
  organizations: number;
}>;

/** How Stripe treats tax on a price; one Stripe adds later reads `other`. */
export type BillingPriceTaxBehavior = "exclusive" | "inclusive" | "unspecified" | "other";

/** One price in the Stripe account, keyed to billing's catalogue name where it has one. */
export type BillingStripePriceFact = Readonly<{
  priceId: string;
  catalogueName: StripePriceName | "other";
  currency: string;
  unitAmount: number | null;
  interval: "day" | "week" | "month" | "year" | null;
  intervalCount: number | null;
  taxBehavior: BillingPriceTaxBehavior | null;
  active: boolean;
  livemode: boolean;
}>;

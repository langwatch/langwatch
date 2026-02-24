import type { Currency } from "@prisma/client";
import { prices } from "../stripe/stripePriceCatalog";
import type { StripePriceName } from "../stripe/stripePrices.types";
import { PlanTypes, type PlanTypes as PlanType } from "../planTypes";

/** Set of all GROWTH_SEAT price IDs resolved from the Stripe catalog. */
const GROWTH_SEAT_PRICE_IDS = new Set([
  prices.GROWTH_SEAT_EUR_MONTHLY,
  prices.GROWTH_SEAT_EUR_ANNUAL,
  prices.GROWTH_SEAT_USD_MONTHLY,
  prices.GROWTH_SEAT_USD_ANNUAL,
]);

/** Set of all GROWTH_EVENTS price IDs resolved from the Stripe catalog. */
const GROWTH_EVENTS_PRICE_IDS = new Set([
  prices.GROWTH_EVENTS_EUR_MONTHLY,
  prices.GROWTH_EVENTS_EUR_ANNUAL,
  prices.GROWTH_EVENTS_USD_MONTHLY,
  prices.GROWTH_EVENTS_USD_ANNUAL,
]);

/** Checks whether a given price ID corresponds to a Growth seat price. */
export const isGrowthSeatPrice = (priceId: string): boolean =>
  GROWTH_SEAT_PRICE_IDS.has(priceId);

/** Checks whether a given price ID corresponds to a Growth events price. */
export const isGrowthEventsPrice = (priceId: string): boolean =>
  GROWTH_EVENTS_PRICE_IDS.has(priceId);

export type BillingInterval = "monthly" | "annual";

/** All GROWTH_SEAT plan type strings. */
export const GROWTH_SEAT_PLAN_TYPES = [
  PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
  PlanTypes.GROWTH_SEAT_EUR_ANNUAL,
  PlanTypes.GROWTH_SEAT_USD_MONTHLY,
  PlanTypes.GROWTH_SEAT_USD_ANNUAL,
] as const;

/** Type guard: returns true for any of the four GROWTH_SEAT_* plan types. */
export const isGrowthSeatEventPlan = (plan: string): boolean =>
  plan.startsWith("GROWTH_SEAT_");

/** Builds the plan type string from currency + billing interval. */
export const resolveGrowthSeatPlanType = (
  currency: Currency,
  interval: BillingInterval,
): PlanType =>
  `GROWTH_SEAT_${currency}_${interval.toUpperCase()}` as PlanType;

/** Extracts currency and billing interval from a GROWTH_SEAT plan type. */
export const parseGrowthSeatPlanType = (
  plan: string,
): { currency: Currency; billingInterval: BillingInterval } | null => {
  const match = plan.match(/^GROWTH_SEAT_(EUR|USD)_(MONTHLY|ANNUAL)$/);
  if (!match) return null;
  return {
    currency: match[1] as Currency,
    billingInterval: match[2]!.toLowerCase() as BillingInterval,
  };
};

/** Resolves the Stripe price ID for a Growth seat given currency and interval. */
export const resolveGrowthSeatPriceId = (
  currency: Currency,
  interval: BillingInterval,
): string => {
  const key =
    `GROWTH_SEAT_${currency}_${interval.toUpperCase()}` as StripePriceName;
  return prices[key];
};

/** Resolves the Stripe price ID for Growth events given currency and interval. */
export const resolveGrowthEventsPriceId = (
  currency: Currency,
  interval: BillingInterval,
): string => {
  const key =
    `GROWTH_EVENTS_${currency}_${interval.toUpperCase()}` as StripePriceName;
  return prices[key];
};

/**
 * Creates Stripe checkout line items for a Growth plan subscription.
 *
 * Returns a seat line item (quantity = coreMembers) and a metered events line
 * item (no quantity — Stripe tracks usage via usage records).
 */
export const createCheckoutLineItems = ({
  coreMembers,
  currency,
  interval,
}: {
  coreMembers: number;
  currency: Currency;
  interval: BillingInterval;
}) => [
  {
    price: resolveGrowthSeatPriceId(currency, interval),
    quantity: coreMembers,
  },
  {
    price: resolveGrowthEventsPriceId(currency, interval),
  },
];

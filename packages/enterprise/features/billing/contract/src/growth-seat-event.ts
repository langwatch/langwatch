import type { Currency } from "./pricing";
import { InvalidSeatCountError } from "./billing.errors";
import { GROWTH_SEAT_PLAN_TYPES } from "./plan-types";
import type { StripePriceMap, StripePriceName } from "./stripe-prices";

/** Set of all GROWTH_SEAT price IDs resolved from the Stripe catalog. */
const priceIds = (prices: StripePriceMap, names: readonly StripePriceName[]) =>
  new Set(names.map((name) => prices[name]));

/** Set of all GROWTH_EVENTS price IDs resolved from the Stripe catalog. */
const GROWTH_EVENTS_PRICE_NAMES = [
  "GROWTH_EVENTS_EUR_MONTHLY",
  "GROWTH_EVENTS_EUR_ANNUAL",
  "GROWTH_EVENTS_USD_MONTHLY",
  "GROWTH_EVENTS_USD_ANNUAL",
  // Pre-March 2026 prices (grandfathered customers on old €1/$1 per 100K rate)
  "GROWTH_EVENTS_EUR_MONTHLY_UNTIL_MAR_2026",
  "GROWTH_EVENTS_EUR_ANNUAL_UNTIL_MAR_2026",
  "GROWTH_EVENTS_USD_MONTHLY_UNTIL_MAR_2026",
  "GROWTH_EVENTS_USD_ANNUAL_UNTIL_MAR_2026",
] as const satisfies readonly StripePriceName[];

/** Checks whether a given price ID corresponds to a Growth seat price. */
export const isGrowthSeatPrice = (priceId: string, prices: StripePriceMap): boolean =>
  priceIds(prices, [
    "GROWTH_SEAT_EUR_MONTHLY",
    "GROWTH_SEAT_EUR_ANNUAL",
    "GROWTH_SEAT_USD_MONTHLY",
    "GROWTH_SEAT_USD_ANNUAL",
  ]).has(priceId);

/** Checks whether a given price ID corresponds to a Growth events price. */
export const isGrowthEventsPrice = (priceId: string, prices: StripePriceMap): boolean =>
  priceIds(prices, GROWTH_EVENTS_PRICE_NAMES).has(priceId);

/** Growth events prices with an annual interval — the ones whose accrued
 * usage would otherwise only be collected at renewal. */
const ANNUAL_GROWTH_EVENTS_PRICE_NAMES = [
  "GROWTH_EVENTS_EUR_ANNUAL",
  "GROWTH_EVENTS_USD_ANNUAL",
  "GROWTH_EVENTS_EUR_ANNUAL_UNTIL_MAR_2026",
  "GROWTH_EVENTS_USD_ANNUAL_UNTIL_MAR_2026",
] as const satisfies readonly StripePriceName[];

/** Checks whether a given price ID is an annually-billed Growth events price. */
export const isAnnualGrowthEventsPrice = (priceId: string, prices: StripePriceMap): boolean =>
  priceIds(prices, ANNUAL_GROWTH_EVENTS_PRICE_NAMES).has(priceId);

export type BillingInterval = "monthly" | "annual";

export type GrowthSeatPlanType = (typeof GROWTH_SEAT_PLAN_TYPES)[number];

/** Type guard: returns true for any of the four GROWTH_SEAT_* plan types. */
export const isGrowthSeatEventPlan = (planType: string): planType is GrowthSeatPlanType =>
  (GROWTH_SEAT_PLAN_TYPES as readonly string[]).includes(planType);

/** Builds the plan type string from currency + billing interval. */
export const resolveGrowthSeatPlanType = ({
  currency,
  interval,
}: {
  currency: Currency;
  interval: BillingInterval;
}): GrowthSeatPlanType => `GROWTH_SEAT_${currency}_${interval.toUpperCase()}` as GrowthSeatPlanType;

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
export const resolveGrowthSeatPriceId = ({
  currency,
  interval,
  prices,
}: {
  currency: Currency;
  interval: BillingInterval;
  prices: StripePriceMap;
}): string => {
  const key = `GROWTH_SEAT_${currency}_${interval.toUpperCase()}` as StripePriceName;
  const priceId = prices[key];
  if (!priceId) {
    throw new Error(`Unsupported Growth seat price: ${currency}/${interval}`);
  }
  return priceId;
};

/** Resolves the Stripe price ID for Growth events given currency and interval. */
export const resolveGrowthEventsPriceId = ({
  currency,
  interval,
  prices,
}: {
  currency: Currency;
  interval: BillingInterval;
  prices: StripePriceMap;
}): string => {
  const key = `GROWTH_EVENTS_${currency}_${interval.toUpperCase()}` as StripePriceName;
  const priceId = prices[key];
  if (!priceId) {
    throw new Error(`Unsupported Growth events price: ${currency}/${interval}`);
  }
  return priceId;
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
  prices,
}: {
  coreMembers: number;
  currency: Currency;
  interval: BillingInterval;
  prices: StripePriceMap;
}) => {
  if (coreMembers < 1) {
    throw new InvalidSeatCountError(coreMembers);
  }
  return [
    {
      price: resolveGrowthSeatPriceId({ currency, interval, prices }),
      quantity: coreMembers,
    },
    {
      price: resolveGrowthEventsPriceId({ currency, interval, prices }),
    },
  ];
};

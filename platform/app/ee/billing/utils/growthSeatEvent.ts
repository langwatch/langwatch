import type { Currency } from "~/generated/prisma/client";
import { InvalidSeatCountError } from "../errors";
import { PlanTypes } from "../planTypes";
import { prices } from "../stripe/stripePriceCatalog";
import type { StripePriceName } from "../stripe/stripePrices.types";

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
  // Pre-March 2026 prices (grandfathered customers on old €1/$1 per 100K rate)
  prices.GROWTH_EVENTS_EUR_MONTHLY_UNTIL_MAR_2026,
  prices.GROWTH_EVENTS_EUR_ANNUAL_UNTIL_MAR_2026,
  prices.GROWTH_EVENTS_USD_MONTHLY_UNTIL_MAR_2026,
  prices.GROWTH_EVENTS_USD_ANNUAL_UNTIL_MAR_2026,
]);

/** Checks whether a given price ID corresponds to a Growth seat price. */
export const isGrowthSeatPrice = (priceId: string): boolean =>
  GROWTH_SEAT_PRICE_IDS.has(priceId);

/** Checks whether a given price ID corresponds to a Growth events price. */
export const isGrowthEventsPrice = (priceId: string): boolean =>
  GROWTH_EVENTS_PRICE_IDS.has(priceId);

/** Growth events prices with an annual interval — the ones whose accrued
 * usage would otherwise only be collected at renewal. */
const ANNUAL_GROWTH_EVENTS_PRICE_IDS = new Set([
  prices.GROWTH_EVENTS_EUR_ANNUAL,
  prices.GROWTH_EVENTS_USD_ANNUAL,
  prices.GROWTH_EVENTS_EUR_ANNUAL_UNTIL_MAR_2026,
  prices.GROWTH_EVENTS_USD_ANNUAL_UNTIL_MAR_2026,
]);

/** Checks whether a given price ID is an annually-billed Growth events price. */
export const isAnnualGrowthEventsPrice = (priceId: string): boolean =>
  ANNUAL_GROWTH_EVENTS_PRICE_IDS.has(priceId);

export type BillingInterval = "monthly" | "annual";

/** All GROWTH_SEAT plan type strings. */
export const GROWTH_SEAT_PLAN_TYPES = [
  PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
  PlanTypes.GROWTH_SEAT_EUR_ANNUAL,
  PlanTypes.GROWTH_SEAT_USD_MONTHLY,
  PlanTypes.GROWTH_SEAT_USD_ANNUAL,
] as const;

export type GrowthSeatPlanType = (typeof GROWTH_SEAT_PLAN_TYPES)[number];

/** Type guard: returns true for any of the four GROWTH_SEAT_* plan types. */
export const isGrowthSeatEventPlan = (
  planType: string,
): planType is GrowthSeatPlanType =>
  (GROWTH_SEAT_PLAN_TYPES as readonly string[]).includes(planType);

/** Builds the plan type string from currency + billing interval. */
export const resolveGrowthSeatPlanType = ({
  currency,
  interval,
}: {
  currency: Currency;
  interval: BillingInterval;
}): GrowthSeatPlanType =>
  `GROWTH_SEAT_${currency}_${interval.toUpperCase()}` as GrowthSeatPlanType;

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
}: {
  currency: Currency;
  interval: BillingInterval;
}): string => {
  const key =
    `GROWTH_SEAT_${currency}_${interval.toUpperCase()}` as StripePriceName;
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
}: {
  currency: Currency;
  interval: BillingInterval;
}): string => {
  const key =
    `GROWTH_EVENTS_${currency}_${interval.toUpperCase()}` as StripePriceName;
  const priceId = prices[key];
  if (!priceId) {
    throw new Error(`Unsupported Growth events price: ${currency}/${interval}`);
  }
  return priceId;
};

/**
 * The Instant Evals price on a Growth subscription, when there is one.
 *
 * Priced in United States dollars only, and only once the meter and price
 * exist in the Stripe mode being run: both are provisioned per mode by hand,
 * so between this code landing and that provisioning the name resolves to
 * nothing and a Growth subscription simply carries no Instant Evals item. It
 * is not an error, and it must not be: a checkout that failed because a meter
 * for a separate feature was not yet created would block every Growth signup.
 */
export const resolveGrowthInstantEvalPriceId = ({
  currency,
}: {
  currency: Currency;
}): string | undefined =>
  currency === "USD" ? prices.GROWTH_INSTANT_EVAL_USD : undefined;

/** Whether this deployment's Stripe mode has the Instant Evals price. */
export const isGrowthInstantEvalPriceProvisioned = (): boolean =>
  Boolean(prices.GROWTH_INSTANT_EVAL_USD);

/**
 * Creates Stripe checkout line items for a Growth plan subscription.
 *
 * Returns a seat line item (quantity = coreMembers), a metered events line
 * item, and, where it is provisioned, a metered Instant Evals line item
 * (neither metered item carries a quantity — Stripe tracks usage via usage
 * records).
 */
export const createCheckoutLineItems = ({
  coreMembers,
  currency,
  interval,
}: {
  coreMembers: number;
  currency: Currency;
  interval: BillingInterval;
}) => {
  if (coreMembers < 1) {
    throw new InvalidSeatCountError(coreMembers);
  }
  const instantEvalPriceId = resolveGrowthInstantEvalPriceId({ currency });
  return [
    {
      price: resolveGrowthSeatPriceId({ currency, interval }),
      quantity: coreMembers,
    },
    {
      price: resolveGrowthEventsPriceId({ currency, interval }),
    },
    ...(instantEvalPriceId ? [{ price: instantEvalPriceId }] : []),
  ];
};

import type { Currency } from "@prisma/client";
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
]);

/** Checks whether a given price ID corresponds to a Growth seat price. */
export const isGrowthSeatPrice = (priceId: string): boolean =>
  GROWTH_SEAT_PRICE_IDS.has(priceId);

/** Checks whether a given price ID corresponds to a Growth events price. */
export const isGrowthEventsPrice = (priceId: string): boolean =>
  GROWTH_EVENTS_PRICE_IDS.has(priceId);

type BillingInterval = "monthly" | "annual";

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

/**
 * Developer seats on a Growth subscription: sold only where an operator configured their
 * Stripe price for the subscription's currency and interval (an optional catalogue name).
 * @see specs/licensing/seat-buying.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { BillingInterval } from "./growth-seat-event.ts";
import type { Currency } from "./pricing.ts";
import type { StripePriceMap, StripePriceName } from "./stripe-prices.ts";

const DEVELOPER_SEAT_PRICE_NAMES = [
  "DEVELOPER_SEAT_EUR_MONTHLY",
  "DEVELOPER_SEAT_EUR_ANNUAL",
  "DEVELOPER_SEAT_USD_MONTHLY",
  "DEVELOPER_SEAT_USD_ANNUAL",
] as const satisfies readonly StripePriceName[];

/** Whether Developer seats are sold in this currency and interval, and at which price. */
export type DeveloperSeatOffer = { sold: true; priceId: string } | { sold: false };

/** The configured Developer seat price for this currency and interval, if one is configured. */
export const developerSeatOfferFor = ({
  currency,
  interval,
  prices,
}: {
  currency: Currency;
  interval: BillingInterval;
  prices: StripePriceMap;
}): DeveloperSeatOffer => {
  const key = `DEVELOPER_SEAT_${currency}_${interval.toUpperCase()}` as StripePriceName;
  const priceId = prices[key];
  return priceId ? { sold: true, priceId } : { sold: false };
};

/** Whether a subscription line bills Developer seats. */
export const isDeveloperSeatPrice = (priceId: string, prices: StripePriceMap): boolean =>
  DEVELOPER_SEAT_PRICE_NAMES.some((name) => prices[name] === priceId);

const developerSeatsSchemaDefinition = z.object({
  /** False while no price is configured: nothing about Developer seats is offered. */
  available: z.boolean(),
  /** Developer seats the subscription bills now. */
  quantity: z.number().int().nonnegative(),
  /** Per seat per billing period, in the currency's minor unit; null while unavailable. */
  unitAmountCents: z.number().int().nonnegative().nullable(),
  currency: z.string(),
  billingInterval: z.string(),
  /** When the period already invoiced ends, epoch milliseconds; null when unknown. */
  periodEndsAt: z.number().nullable(),
});
export interface DeveloperSeatsSchema extends Named<typeof developerSeatsSchemaDefinition> {}
export const developerSeatsSchema: DeveloperSeatsSchema = developerSeatsSchemaDefinition;
export type DeveloperSeats = z.infer<typeof developerSeatsSchema>;

const developerSeatQuoteSchemaDefinition = z.object({
  amountDueCents: z.number(),
  formattedAmountDue: z.string(),
  formattedRecurringTotal: z.string(),
  billingInterval: z.string(),
  /** The instant this quote priced, sent back on confirm so the charge matches it. */
  quotedAt: z.number(),
});
export interface DeveloperSeatQuoteSchema extends Named<
  typeof developerSeatQuoteSchemaDefinition
> {}
export const developerSeatQuoteSchema: DeveloperSeatQuoteSchema =
  developerSeatQuoteSchemaDefinition;
export type DeveloperSeatQuote = z.infer<typeof developerSeatQuoteSchema>;

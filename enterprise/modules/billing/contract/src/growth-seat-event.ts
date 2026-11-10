import { GROWTH_INCLUDED_RETENTION_DAYS } from "@langwatch/data-retention-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { InvalidSeatCountError } from "./billing.errors.ts";
import { GROWTH_SEAT_PLAN_TYPES } from "./plan-types.ts";
import type { Currency } from "./pricing.ts";
import type { StripePriceMap, StripePriceName } from "./stripe-prices.ts";

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
 * The Instant Evals price on a Growth subscription, when the mode has one.
 * Dollars only, and absent until the meter behind it is provisioned: failing a
 * checkout over another feature's meter would block every Growth signup.
 */
export const pickGrowthInstantEvalPriceId = ({
  currency,
  prices,
}: {
  currency: Currency;
  prices: StripePriceMap;
}): string | undefined => (currency === "USD" ? prices.GROWTH_INSTANT_EVAL_USD : undefined);

/** Whether this deployment's Stripe mode has the Instant Evals price. */
export const isGrowthInstantEvalPriceProvisioned = ({
  prices,
}: {
  prices: StripePriceMap;
}): boolean => Boolean(prices.GROWTH_INSTANT_EVAL_USD);

const RETENTION_STORAGE_PRICE_NAMES = [
  "RETENTION_STORAGE_EUR_MONTHLY",
  "RETENTION_STORAGE_EUR_ANNUAL",
  "RETENTION_STORAGE_USD_MONTHLY",
  "RETENTION_STORAGE_USD_ANNUAL",
] as const satisfies readonly StripePriceName[];

/** The metered price for storage above 90 days in this currency and interval, when provisioned. */
export const pickRetentionStoragePriceId = ({
  currency,
  interval,
  prices,
}: {
  currency: Currency;
  interval: BillingInterval;
  prices: StripePriceMap;
}): string | undefined =>
  prices[`RETENTION_STORAGE_${currency}_${interval.toUpperCase()}` as StripePriceName];

/** Whether a subscription line bills storage above the included retention. */
export const isRetentionStoragePrice = (priceId: string, prices: StripePriceMap): boolean =>
  RETENTION_STORAGE_PRICE_NAMES.some((name) => prices[name] === priceId);

/** A retention above what Growth includes bills the storage it keeps beyond 90 days. */
export const retentionBillsStorage = (retentionDays: number | undefined): boolean =>
  retentionDays !== undefined && retentionDays > GROWTH_INCLUDED_RETENTION_DAYS;

/**
 * Stripe checkout line items for Growth: a seat item (quantity = coreMembers), metered events,
 * metered Instant Evals where provisioned, and metered storage above 90 days of retention.
 * No metered item carries a quantity.
 */
export const createCheckoutLineItems = ({
  coreMembers,
  currency,
  interval,
  prices,
  retentionDays,
}: {
  coreMembers: number;
  currency: Currency;
  interval: BillingInterval;
  prices: StripePriceMap;
  retentionDays?: number;
}): { price: string; quantity?: number }[] => {
  if (coreMembers < 1) {
    throw new InvalidSeatCountError(coreMembers);
  }
  const instantEvalPriceId = pickGrowthInstantEvalPriceId({ currency, prices });
  const storagePriceId = retentionBillsStorage(retentionDays)
    ? pickRetentionStoragePriceId({ currency, interval, prices })
    : undefined;

  return [
    {
      price: resolveGrowthSeatPriceId({ currency, interval, prices }),
      quantity: coreMembers,
    },
    {
      price: resolveGrowthEventsPriceId({ currency, interval, prices }),
    },
    ...(instantEvalPriceId ? [{ price: instantEvalPriceId }] : []),
    ...(storagePriceId ? [{ price: storagePriceId }] : []),
  ];
};

/** Developer seats: sold only where an operator configured their optional catalogue price. */
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

/** What data retention tells billing about storage past the included retention. */
const retentionStorageReportSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    /** The longest retention any of the organization's rules keeps; 0 keeps forever. */
    longestRetentionDays: z.number().int().nonnegative(),
    /**
     * The bytes stored in rows older than the included 90 days, measured now. Absent when the
     * retention changed and only the subscription line has to follow it.
     */
    bytesAboveIncluded: z.number().finite().nonnegative().optional(),
    /** When the bytes were measured, in epoch milliseconds; it names the day the share covers. */
    measuredAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export interface RetentionStorageReportSchema extends Named<
  typeof retentionStorageReportSchemaDefinition
> {}
export const retentionStorageReportSchema: RetentionStorageReportSchema =
  retentionStorageReportSchemaDefinition;
export type RetentionStorageReport = z.infer<typeof retentionStorageReportSchema>;

/** What recording one organization's storage did. */
export type RetentionStorageOutcome = Readonly<{
  /** `skipped`: no Growth seat subscription, or the storage price is not provisioned here. */
  line: "added" | "kept" | "removed" | "absent" | "skipped";
  /** The GB-month share sent to the meter, when a measurement was sent. */
  reportedGbMonths: number | null;
}>;

/** The storage meter's identifier: one per organization and UTC day, so a day bills once. */
export function retentionStorageMeterIdentifier({
  organizationId,
  day,
}: {
  organizationId: string;
  day: string;
}): string {
  return `retention-storage:${organizationId}:${day}`;
}

/** Bytes in one GB, as storage is priced. */
export const BYTES_PER_GB = 1_000_000_000;

/**
 * One day's share of a GB-month: the GB stored that day over the days in its month. The meter
 * sums the daily shares, so a month reported every day bills the month's average GB.
 */
export function dailyGbMonthShare({
  bytes,
  daysInMonth,
}: {
  bytes: number;
  daysInMonth: number;
}): number {
  return bytes / BYTES_PER_GB / daysInMonth;
}

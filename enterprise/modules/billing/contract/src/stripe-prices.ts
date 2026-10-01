export const STRIPE_PRICE_NAMES = [
  "PRO",
  "GROWTH",
  "LAUNCH",
  "LAUNCH_ANNUAL",
  "ACCELERATE",
  "ACCELERATE_ANNUAL",
  "LAUNCH_USERS",
  "ACCELERATE_USERS",
  "LAUNCH_TRACES_10K",
  "ACCELERATE_TRACES_100K",
  "LAUNCH_ANNUAL_TRACES_10K",
  "ACCELERATE_ANNUAL_TRACES_100K",
  "LAUNCH_ANNUAL_USERS",
  "ACCELERATE_ANNUAL_USERS",
  "GROWTH_SEAT_EUR_MONTHLY",
  "GROWTH_SEAT_EUR_ANNUAL",
  "GROWTH_SEAT_USD_MONTHLY",
  "GROWTH_SEAT_USD_ANNUAL",
  "GROWTH_EVENTS_EUR_MONTHLY",
  "GROWTH_EVENTS_EUR_ANNUAL",
  "GROWTH_EVENTS_USD_MONTHLY",
  "GROWTH_EVENTS_USD_ANNUAL",
  "GROWTH_EVENTS_EUR_MONTHLY_UNTIL_MAR_2026",
  "GROWTH_EVENTS_EUR_ANNUAL_UNTIL_MAR_2026",
  "GROWTH_EVENTS_USD_MONTHLY_UNTIL_MAR_2026",
  "GROWTH_EVENTS_USD_ANNUAL_UNTIL_MAR_2026",
  "GROWTH_INSTANT_EVAL_USD",
  "CONNECTED_HOSTED_USAGE_QUARTERLY",
] as const;

export type StripePriceName = (typeof STRIPE_PRICE_NAMES)[number];

/**
 * Names that may be absent from the catalog in a given Stripe mode. They are
 * provisioned per mode by hand, so the feature stays off rather than the whole
 * deployment failing to boot; every other name is required.
 */
export const OPTIONAL_STRIPE_PRICE_NAMES: readonly StripePriceName[] = [
  "GROWTH_INSTANT_EVAL_USD",
  "CONNECTED_HOSTED_USAGE_QUARTERLY",
];

export type StripeEnvironment = "test" | "live";

export type StripePriceDetail = {
  id: string;
  active: boolean;
  livemode: boolean;
  product: string | null;
  unitAmount: number | null;
  currency: string;
  type: "one_time" | "recurring";
  recurring: {
    interval: "day" | "week" | "month" | "year";
    intervalCount: number;
  } | null;
  nickname: string | null;
  lookupKey: string | null;
  metadata: Record<string, string>;
};

export type StripePriceMapping = Record<
  StripePriceName,
  Partial<Record<StripeEnvironment, string>> | undefined
>;

export const STRIPE_METER_NAMES = ["BILLABLE_EVENTS", "INSTANT_EVAL_USD"] as const;
export type StripeMeterName = (typeof STRIPE_METER_NAMES)[number];

/** Meters that may be absent from the catalog in a given Stripe mode. */
export const OPTIONAL_STRIPE_METER_NAMES: readonly StripeMeterName[] = ["INSTANT_EVAL_USD"];

export type StripeMeterMapping = Record<
  StripeMeterName,
  Record<StripeEnvironment, string> | undefined
>;
export type StripeMeterMap = Partial<Record<StripeMeterName, string>> &
  Record<Exclude<StripeMeterName, "INSTANT_EVAL_USD">, string>;

export type StripePricesFile = {
  schemaVersion: number;
  updatedAt: string;
  mapping: StripePriceMapping;
  meters: StripeMeterMapping;
  prices: Record<string, StripePriceDetail>;
};

/** Resolved ids; an optional price is absent until its mode is provisioned. */
export type StripePriceMap = Partial<Record<StripePriceName, string>> &
  Record<
    Exclude<StripePriceName, "GROWTH_INSTANT_EVAL_USD" | "CONNECTED_HOSTED_USAGE_QUARTERLY">,
    string
  >;

import { z } from "zod";

export const stripePriceRecurringSchema = z.object({
  interval: z.enum(["day", "week", "month", "year"]),
  intervalCount: z.number(),
});

export const stripePriceDetailSchema = z.object({
  id: z.string(),
  active: z.boolean(),
  livemode: z.boolean(),
  product: z.string().nullable(),
  unitAmount: z.number().nullable(),
  currency: z.string(),
  type: z.enum(["one_time", "recurring"]),
  recurring: stripePriceRecurringSchema.nullable(),
  nickname: z.string().nullable(),
  lookupKey: z.string().nullable(),
  metadata: z.record(z.string(), z.string()),
});

const stripeEnvironmentMappingSchema = z.object({
  test: z.string(),
  live: z.string(),
});

/** An optional name may be provisioned in one mode and not the other. */
const stripeOptionalEnvironmentMappingSchema = z.object({
  test: z.string().optional(),
  live: z.string().optional(),
});

export const stripePriceMappingSchema = z.object(
  Object.fromEntries(
    STRIPE_PRICE_NAMES.map((key) => [
      key,
      OPTIONAL_STRIPE_PRICE_NAMES.includes(key)
        ? stripeOptionalEnvironmentMappingSchema.optional()
        : stripeEnvironmentMappingSchema,
    ]),
  ) as Record<StripePriceName, typeof stripeEnvironmentMappingSchema>,
);

export const stripeMeterMappingSchema = z.object(
  Object.fromEntries(
    STRIPE_METER_NAMES.map((key) => [
      key,
      OPTIONAL_STRIPE_METER_NAMES.includes(key)
        ? stripeEnvironmentMappingSchema.optional()
        : stripeEnvironmentMappingSchema,
    ]),
  ) as Record<StripeMeterName, typeof stripeEnvironmentMappingSchema>,
);

export const stripePricesFileSchema = z.object({
  schemaVersion: z.number(),
  updatedAt: z.string(),
  mapping: stripePriceMappingSchema,
  meters: stripeMeterMappingSchema,
  prices: z.record(z.string(), stripePriceDetailSchema),
});

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
] as const;

export type StripePriceName = (typeof STRIPE_PRICE_NAMES)[number];

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
  Record<StripeEnvironment, string>
>;

export type StripePricesFile = {
  schemaVersion: number;
  updatedAt: string;
  mapping: StripePriceMapping;
  prices: Record<string, StripePriceDetail>;
};

export type StripePriceMap = Record<StripePriceName, string>;

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

export const stripePriceMappingSchema = z.object(
  Object.fromEntries(
    STRIPE_PRICE_NAMES.map((key) => [key, stripeEnvironmentMappingSchema]),
  ) as Record<StripePriceName, typeof stripeEnvironmentMappingSchema>,
);

export const stripePricesFileSchema = z.object({
  schemaVersion: z.number(),
  updatedAt: z.string(),
  mapping: stripePriceMappingSchema,
  prices: z.record(z.string(), stripePriceDetailSchema),
});

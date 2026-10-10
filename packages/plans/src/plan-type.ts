import { z } from "zod";

/**
 * Every plan a resolved organization can be on. The first twelve are also
 * `PlanTypes` in Postgres; `OPEN_SOURCE` is not, because it is what a
 * self-hosted deployment resolves to when nothing was stored at all.
 */
export const PLAN_TYPES = [
  "FREE",
  "PRO",
  "GROWTH",
  "GROWTH_SEAT_EUR_MONTHLY",
  "GROWTH_SEAT_EUR_ANNUAL",
  "GROWTH_SEAT_USD_MONTHLY",
  "GROWTH_SEAT_USD_ANNUAL",
  "ENTERPRISE",
  "LAUNCH",
  "ACCELERATE",
  "LAUNCH_ANNUAL",
  "ACCELERATE_ANNUAL",
  "OPEN_SOURCE",
] as const;

export const planTypeSchema = z.enum(PLAN_TYPES);
export type PlanType = z.infer<typeof planTypeSchema>;

/** How an organization is billed. Restated from the Postgres `PricingModel` enum. */
export const PRICING_MODELS = ["TIERED", "SEAT_EVENT"] as const;
export const pricingModelSchema = z.enum(PRICING_MODELS);
export type PricingModel = z.infer<typeof pricingModelSchema>;

/** The currencies a plan is quoted in. Restated from the Postgres `Currency` enum. */
export const CURRENCIES = ["USD", "EUR"] as const;
export const currencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currencySchema>;

export const moneyByCurrencySchema = z.object({
  USD: z.number(),
  EUR: z.number(),
});
export type MoneyByCurrency = z.infer<typeof moneyByCurrencySchema>;

/** Which deployment a baseline plan answers for. */
export const deploymentSchema = z.enum(["cloud", "self-hosted"]);
export type Deployment = z.infer<typeof deploymentSchema>;

import { z } from "zod";
import { planDisputeIdSchema } from "./disputes.ts";
import { planGatesSchema } from "./gates.ts";
import { planLimitsSchema } from "./limits.ts";
import { moneyByCurrencySchema, planTypeSchema, pricingModelSchema } from "./plan-type.ts";

export const billingPeriodSchema = z.enum(["monthly", "annual", "none"]);
export type BillingPeriod = z.infer<typeof billingPeriodSchema>;

export const planPricingSchema = z.object({
  model: pricingModelSchema.nullable(),
  period: billingPeriodSchema,
  /** The list price for one billing period, per currency. */
  prices: moneyByCurrencySchema,
  /** Set only where the price is per seat rather than per period. */
  seatPrice: moneyByCurrencySchema.nullable(),
});
export type PlanPricing = z.infer<typeof planPricingSchema>;

/**
 * Where a plan sits on the self-serve ladder. Annual variants carry the rung of
 * the monthly plan they are the same plan as, so an annual contract never reads
 * as a step above the monthly one.
 */
export const planRungPlacementSchema = z.object({
  ladder: pricingModelSchema,
  rung: planTypeSchema,
  order: z.number().int(),
});
export type PlanRungPlacement = z.infer<typeof planRungPlacementSchema>;

export const planSchema = z.object({
  type: planTypeSchema,
  name: z.string(),
  free: z.boolean(),
  /** Whether Postgres can store this type in `PlanTypes`. */
  storedAsPlanType: z.boolean(),
  /** True for a plan a person sells: it is never offered self-serve. */
  accountManaged: z.boolean(),
  pricing: planPricingSchema,
  limits: planLimitsSchema,
  gates: planGatesSchema,
  selfServe: planRungPlacementSchema.nullable(),
  /** Disputes this plan's own numbers are subject to. See disputes.ts. */
  disputed: z.array(planDisputeIdSchema).readonly(),
});
export type Plan = z.infer<typeof planSchema>;

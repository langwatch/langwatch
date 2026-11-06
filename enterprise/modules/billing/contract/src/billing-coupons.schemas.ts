// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Stripe coupons and their promotion codes as the Cloud admin console reads and
 * writes them, each code judged against the Growth checkout. Instants travel as
 * ISO strings: tRPC carries no transformer.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

const isoInstantSchema = z.iso.datetime({ offset: true });

/** How long a coupon keeps discounting a subscription, in Stripe's own words. */
export const COUPON_DURATIONS = ["once", "repeating", "forever"] as const;
export type CouponDuration = (typeof COUPON_DURATIONS)[number];

/** The products the Growth checkout charges, named where a coupon targets one of them. */
export const GROWTH_PRODUCT_ROLES = ["growth_seats", "growth_events"] as const;
export type GrowthProductRole = (typeof GROWTH_PRODUCT_ROLES)[number];

/** Why the Growth checkout refuses a code; each is one row of the coupons spec. */
export const COUPON_REFUSAL_REASONS = [
  "amount_off",
  "no_growth_product",
  "first_time_only",
  "inactive",
  "expired",
  "redemption_limit_reached",
] as const;
export type CouponRefusalReason = (typeof COUPON_REFUSAL_REASONS)[number];

/** What a code allows yet may still surprise: the checkout takes it, with a caveat. */
export const COUPON_WARNINGS = ["minimum_amount", "single_customer"] as const;
export type CouponWarning = (typeof COUPON_WARNINGS)[number];

const couponProductSchema = z.object({
  id: z.string(),
  role: z.enum(GROWTH_PRODUCT_ROLES).nullable(),
});
export type CouponProduct = z.infer<typeof couponProductSchema>;

const couponVerdictSchema = z.object({
  accepted: z.boolean(),
  reasons: z.array(z.object({ code: z.enum(COUPON_REFUSAL_REASONS), message: z.string() })),
  warnings: z.array(z.object({ code: z.enum(COUPON_WARNINGS), message: z.string() })),
});
export type CouponVerdict = z.infer<typeof couponVerdictSchema>;

const promotionCodeViewSchema = z.object({
  id: z.string(),
  code: z.string(),
  active: z.boolean(),
  timesRedeemed: z.number().int(),
  maxRedemptions: z.number().int().nullable(),
  expiresAt: isoInstantSchema.nullable(),
  createdAt: isoInstantSchema,
  firstTimeTransaction: z.boolean(),
  minimumAmount: z.number().int().nullable(),
  minimumAmountCurrency: z.string().nullable(),
  /** A code only one customer may redeem names that customer's id. */
  customerId: z.string().nullable(),
  verdict: couponVerdictSchema,
});
export type PromotionCodeView = z.infer<typeof promotionCodeViewSchema>;

const couponViewSchemaDefinition = z.object({
  id: z.string(),
  name: z.string().nullable(),
  percentOff: z.number().nullable(),
  /** In the currency's minor unit, for a fixed-amount coupon. */
  amountOff: z.number().int().nullable(),
  currency: z.string().nullable(),
  duration: z.enum(COUPON_DURATIONS),
  durationInMonths: z.number().int().nullable(),
  /** Null when the coupon applies to every product. */
  products: z.array(couponProductSchema).nullable(),
  valid: z.boolean(),
  timesRedeemed: z.number().int(),
  maxRedemptions: z.number().int().nullable(),
  redeemBy: isoInstantSchema.nullable(),
  createdAt: isoInstantSchema,
  codes: z.array(promotionCodeViewSchema),
});
export interface CouponViewSchema extends Named<typeof couponViewSchemaDefinition> {}
export const couponViewSchema: CouponViewSchema = couponViewSchemaDefinition;
export type CouponView = z.infer<typeof couponViewSchema>;

const couponListSchemaDefinition = z.object({ coupons: z.array(couponViewSchema) });
export interface CouponListSchema extends Named<typeof couponListSchemaDefinition> {}
export const couponListSchema: CouponListSchema = couponListSchemaDefinition;
export type CouponList = z.infer<typeof couponListSchema>;

/**
 * A percentage coupon on the Growth products with one promotion code. Ranges are
 * the service's to refuse with copy the drawer shows, so only types are pinned here.
 */
const createCouponRequestSchemaDefinition = z.object({
  percentOff: z.number(),
  duration: z.enum(COUPON_DURATIONS),
  durationInMonths: z.number().int().optional(),
  name: z.string().trim().max(40).optional(),
  code: z.string().trim(),
  includeEvents: z.boolean().optional(),
  maxRedemptions: z.number().int().optional(),
  expiresAt: isoInstantSchema.optional(),
});
export interface CreateCouponRequestSchema extends Named<
  typeof createCouponRequestSchemaDefinition
> {}
export const createCouponRequestSchema: CreateCouponRequestSchema =
  createCouponRequestSchemaDefinition;
export type CreateCouponRequest = z.infer<typeof createCouponRequestSchema>;

const promotionCodeTargetSchemaDefinition = z.object({ promotionCodeId: z.string().min(1) });
export interface PromotionCodeTargetSchema extends Named<
  typeof promotionCodeTargetSchemaDefinition
> {}
export const promotionCodeTargetSchema: PromotionCodeTargetSchema =
  promotionCodeTargetSchemaDefinition;
export type PromotionCodeTarget = z.infer<typeof promotionCodeTargetSchema>;

/** One field of a create request the service refused, with the copy the drawer shows. */
export type CouponInputProblem = Readonly<{
  field: "percentOff" | "durationInMonths" | "code" | "maxRedemptions" | "expiresAt";
  message: string;
}>;

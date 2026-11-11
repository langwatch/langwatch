// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The coupons subject of billing's Stripe channels (Q69): the account's coupons and
 * promotion codes, read whole and written one at a time, in billing's own shape.
 * Instants are epoch seconds, as Stripe holds them.
 */

import type { CouponDuration } from "@langwatch/enterprise-billing-contract";

/** A coupon as billing reads it; `products` is null when it applies to every product. */
export type StripeCoupon = Readonly<{
  id: string;
  name: string | null;
  percentOff: number | null;
  amountOff: number | null;
  currency: string | null;
  duration: CouponDuration;
  durationInMonths: number | null;
  products: readonly string[] | null;
  valid: boolean;
  timesRedeemed: number;
  maxRedemptions: number | null;
  redeemBy: number | null;
  created: number;
}>;

/** A promotion code as billing reads it, naming the coupon it redeems. */
export type StripePromotionCode = Readonly<{
  id: string;
  code: string;
  couponId: string;
  active: boolean;
  timesRedeemed: number;
  maxRedemptions: number | null;
  expiresAt: number | null;
  created: number;
  customerId: string | null;
  firstTimeTransaction: boolean;
  minimumAmount: number | null;
  minimumAmountCurrency: string | null;
}>;

/** A percentage coupon limited to `products`. */
export type NewStripeCoupon = Readonly<{
  name?: string;
  percentOff: number;
  duration: CouponDuration;
  durationInMonths?: number;
  products: readonly string[];
}>;

/** A promotion code on `couponId`, with no first-time restriction. */
export type NewStripePromotionCode = Readonly<{
  couponId: string;
  code: string;
  maxRedemptions?: number;
  expiresAt?: number;
}>;

export abstract class StripeCouponsChannel {
  /** Every coupon in the account, each with the products it is limited to. */
  abstract listCoupons(): Promise<StripeCoupon[]>;
  /** Every promotion code in the account, active or not. */
  abstract listPromotionCodes(): Promise<StripePromotionCode[]>;
  abstract createCoupon(input: NewStripeCoupon): Promise<StripeCoupon>;
  abstract createPromotionCode(input: NewStripePromotionCode): Promise<StripePromotionCode>;
  /** Undoes a coupon whose code never came to be. */
  abstract deleteCoupon(input: { couponId: string }): Promise<void>;
  abstract deactivatePromotionCode(input: { promotionCodeId: string }): Promise<void>;
}

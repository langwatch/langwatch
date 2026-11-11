// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Whether the Growth checkout takes a promotion code. That checkout bills a prorated
 * first period up to the 1st of next month (`create_prorations` with a billing cycle
 * anchor) for an existing customer, and Stripe answers only "This code is invalid" for
 * a code it will not apply there. Each refusal names the rule; see coupons.feature.
 */

import type {
  CouponProduct,
  CouponRefusalReason,
  CouponVerdict,
  CouponWarning,
  GrowthCheckoutProducts,
} from "@langwatch/enterprise-billing-contract";

import type { StripeCoupon, StripePromotionCode } from "../channels/stripe-coupons.channel.ts";

export const COUPON_REFUSAL_MESSAGES: Readonly<Record<CouponRefusalReason, string>> = {
  amount_off: "Fixed-amount coupons are refused on the prorated checkout",
  no_growth_product: "Does not apply to Growth Seats",
  first_time_only: "First-time-only codes are refused for existing customers",
  inactive: "The code is inactive",
  expired: "The code has expired",
  redemption_limit_reached: "The code has reached its redemption limit",
};

export const COUPON_WARNING_MESSAGES: Readonly<Record<CouponWarning, string>> = {
  minimum_amount:
    "The minimum order is checked on the prorated first charge, which is less than a full month",
  single_customer: "Only the customer it names can redeem this code",
};

/** A code and the coupon it redeems, judged at `now` (epoch seconds). */
export function judgePromotionCode({
  coupon,
  code,
  products,
  now,
}: {
  coupon: StripeCoupon;
  code: StripePromotionCode;
  products: GrowthCheckoutProducts;
  now: number;
}): CouponVerdict {
  const reasons = findRefusals({ coupon, code, products, now });
  const warnings: CouponWarning[] = [];
  if (code.minimumAmount) warnings.push("minimum_amount");
  if (code.customerId) warnings.push("single_customer");
  return {
    accepted: reasons.length === 0,
    reasons: reasons.map((reason) => ({ code: reason, message: COUPON_REFUSAL_MESSAGES[reason] })),
    warnings: warnings.map((warning) => ({
      code: warning,
      message: COUPON_WARNING_MESSAGES[warning],
    })),
  };
}

function findRefusals({
  coupon,
  code,
  products,
  now,
}: {
  coupon: StripeCoupon;
  code: StripePromotionCode;
  products: GrowthCheckoutProducts;
  now: number;
}): CouponRefusalReason[] {
  const reasons: CouponRefusalReason[] = [];
  if (coupon.amountOff !== null) reasons.push("amount_off");
  if (coupon.products && !coupon.products.includes(products.seats)) {
    reasons.push("no_growth_product");
  }
  if (code.firstTimeTransaction) reasons.push("first_time_only");
  if (!code.active || !coupon.valid) reasons.push("inactive");
  const expiry = [code.expiresAt, coupon.redeemBy].filter((at): at is number => at !== null);
  if (expiry.some((at) => at <= now)) reasons.push("expired");
  if (isExhausted(code) || isExhausted(coupon)) reasons.push("redemption_limit_reached");
  return reasons;
}

function isExhausted(held: { timesRedeemed: number; maxRedemptions: number | null }): boolean {
  return held.maxRedemptions !== null && held.timesRedeemed >= held.maxRedemptions;
}

/** The products a coupon is limited to, each Growth product named. */
export function nameCouponProducts({
  productIds,
  products,
}: {
  productIds: readonly string[];
  products: GrowthCheckoutProducts;
}): CouponProduct[] {
  const roles = new Map<string, CouponProduct["role"]>([
    [products.seats, "growth_seats"],
    [products.events, "growth_events"],
  ]);
  return productIds.map((id) => ({ id, role: roles.get(id) ?? null }));
}

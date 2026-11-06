// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/coupons.feature */
import { stripeDouble } from "@langwatch/test-harness/client-doubles/stripe";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { HttpStripeCouponsChannel } from "../http/http.stripe-coupons.channel.ts";
import { MemoryStripeCouponsChannel } from "../memory/memory.stripe-coupons.channel.ts";
import type { StripeCoupon, StripePromotionCode } from "../stripe-coupons.channel.ts";

const COUPON: StripeCoupon = {
  id: "coupon_a",
  name: "Half off",
  percentOff: 50,
  amountOff: null,
  currency: null,
  duration: "repeating",
  durationInMonths: 2,
  products: ["prod_seats"],
  valid: true,
  timesRedeemed: 0,
  maxRedemptions: null,
  redeemBy: null,
  created: 1_800_000_001,
};

const CODE: StripePromotionCode = {
  id: "promo_a",
  code: "HALF50",
  couponId: "coupon_a",
  active: true,
  timesRedeemed: 2,
  maxRedemptions: 5,
  expiresAt: 1_900_000_000,
  created: 1_800_000_002,
  customerId: null,
  firstTimeTransaction: false,
  minimumAmount: null,
  minimumAmountCurrency: null,
};

const atProviderCoupon = (id: string): Stripe.Coupon =>
  ({
    id,
    object: "coupon",
    name: COUPON.name,
    percent_off: COUPON.percentOff,
    amount_off: null,
    currency: null,
    duration: "repeating",
    duration_in_months: 2,
    applies_to: { products: ["prod_seats"] },
    valid: true,
    times_redeemed: 0,
    max_redemptions: null,
    redeem_by: null,
    created: COUPON.created,
  }) as unknown as Stripe.Coupon;

const atProviderCode = {
  id: "promo_a",
  object: "promotion_code",
  code: "HALF50",
  coupon: atProviderCoupon("coupon_a"),
  active: true,
  times_redeemed: 2,
  max_redemptions: 5,
  expires_at: 1_900_000_000,
  created: CODE.created,
  customer: null,
  restrictions: {
    first_time_transaction: false,
    minimum_amount: null,
    minimum_amount_currency: null,
  },
} as unknown as Stripe.PromotionCode;

const list = <T>(data: T[], hasMore = false) => ({
  object: "list" as const,
  data,
  has_more: hasMore,
  url: "/v1/list",
});

describe("Stripe coupons over the provider", () => {
  describe("given coupons on two pages", () => {
    it("follows the cursor and expands each coupon's product limit", async () => {
      const asked: Stripe.CouponListParams[] = [];
      const stripe = stripeDouble({
        coupons: {
          list: async (params?: Stripe.CouponListParams | Stripe.RequestOptions) => {
            const query = (params ?? {}) as Stripe.CouponListParams;
            asked.push(query);
            return query.starting_after
              ? list([atProviderCoupon("coupon_b")])
              : list([atProviderCoupon("coupon_a")], true);
          },
        },
      });

      const coupons = await HttpStripeCouponsChannel.create({ stripe }).listCoupons();

      expect(coupons).toEqual([COUPON, { ...COUPON, id: "coupon_b" }]);
      expect(asked.map((query) => query.starting_after)).toEqual([undefined, "coupon_a"]);
      expect(asked[0]?.expand).toEqual(["data.applies_to"]);
    });
  });

  describe("given a promotion code", () => {
    it("answers it in billing's shape, naming its coupon", async () => {
      const stripe = stripeDouble({
        promotionCodes: { list: async () => list([atProviderCode]) },
      });

      expect(await HttpStripeCouponsChannel.create({ stripe }).listPromotionCodes()).toEqual([CODE]);
    });
  });

  describe("when a coupon and its code are created", () => {
    it("asks for a percentage coupon on the given products and a code with no first-time rule", async () => {
      const coupons: Stripe.CouponCreateParams[] = [];
      const codes: Stripe.PromotionCodeCreateParams[] = [];
      const stripe = stripeDouble({
        coupons: {
          create: async (params?: Stripe.CouponCreateParams | Stripe.RequestOptions) => {
            if (params) coupons.push(params as Stripe.CouponCreateParams);
            return atProviderCoupon("coupon_a");
          },
        },
        promotionCodes: {
          create: async (params: Stripe.PromotionCodeCreateParams) => {
            codes.push(params);
            return atProviderCode;
          },
        },
      });
      const channel = HttpStripeCouponsChannel.create({ stripe });

      await channel.createCoupon({
        percentOff: 50,
        duration: "repeating",
        durationInMonths: 2,
        products: ["prod_seats"],
      });
      await channel.createPromotionCode({ couponId: "coupon_a", code: "HALF50", maxRedemptions: 5 });

      expect(coupons[0]).toMatchObject({
        percent_off: 50,
        duration: "repeating",
        duration_in_months: 2,
        applies_to: { products: ["prod_seats"] },
      });
      expect(coupons[0]).not.toHaveProperty("amount_off");
      expect(codes[0]).toMatchObject({
        coupon: "coupon_a",
        code: "HALF50",
        max_redemptions: 5,
        restrictions: { first_time_transaction: false },
      });
    });
  });
});

describe("Stripe coupons over the memory twin", () => {
  it("refuses a second active code of the same name, whatever the case", async () => {
    const channel = MemoryStripeCouponsChannel.create();
    channel.seed({ coupon: COUPON, codes: [CODE] });

    await expect(
      channel.createPromotionCode({ couponId: "coupon_a", code: "half50" }),
    ).rejects.toMatchObject({ code: "promotion_code_already_exists" });
  });

  it("frees the name once the code is deactivated", async () => {
    const channel = MemoryStripeCouponsChannel.create();
    channel.seed({ coupon: COUPON, codes: [CODE] });

    await channel.deactivatePromotionCode({ promotionCodeId: "promo_a" });
    const again = await channel.createPromotionCode({ couponId: "coupon_a", code: "HALF50" });

    expect(again.active).toBe(true);
  });
});

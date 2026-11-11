// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/coupons.feature */
import { describe, expect, it } from "vitest";

import type { StripeCoupon, StripePromotionCode } from "../../channels/stripe-coupons.channel.ts";
import { judgePromotionCode, nameCouponProducts } from "../coupon-checkout-compatibility.rules.ts";

const PRODUCTS = { seats: "prod_seats", events: "prod_events" };
const NOW = 1_900_000_000;

const coupon = (overrides: Partial<StripeCoupon> = {}): StripeCoupon => ({
  id: "coupon_half",
  name: "Half off",
  percentOff: 50,
  amountOff: null,
  currency: null,
  duration: "repeating",
  durationInMonths: 2,
  products: [PRODUCTS.seats],
  valid: true,
  timesRedeemed: 0,
  maxRedemptions: null,
  redeemBy: null,
  created: NOW - 100,
  ...overrides,
});

const code = (overrides: Partial<StripePromotionCode> = {}): StripePromotionCode => ({
  id: "promo_half",
  code: "HALF50",
  couponId: "coupon_half",
  active: true,
  timesRedeemed: 0,
  maxRedemptions: null,
  expiresAt: null,
  created: NOW - 50,
  customerId: null,
  firstTimeTransaction: false,
  minimumAmount: null,
  minimumAmountCurrency: null,
  ...overrides,
});

const judge = (setup: { coupon?: Partial<StripeCoupon>; code?: Partial<StripePromotionCode> }) =>
  judgePromotionCode({
    coupon: coupon(setup.coupon),
    code: code(setup.code),
    products: PRODUCTS,
    now: NOW,
  });

describe("judgePromotionCode", () => {
  describe("given a code the Growth checkout refuses", () => {
    const rows: {
      setup: string;
      given: { coupon?: Partial<StripeCoupon>; code?: Partial<StripePromotionCode> };
      reason: string;
    }[] = [
      {
        setup: "a fixed amount off",
        given: { coupon: { percentOff: null, amountOff: 2900, currency: "eur" } },
        reason: "Fixed-amount coupons are refused on the prorated checkout",
      },
      {
        setup: "limited to products that exclude Growth Seats",
        given: { coupon: { products: ["prod_other", PRODUCTS.events] } },
        reason: "Does not apply to Growth Seats",
      },
      {
        setup: "first-time orders only",
        given: { code: { firstTimeTransaction: true } },
        reason: "First-time-only codes are refused for existing customers",
      },
      {
        setup: "inactive",
        given: { code: { active: false } },
        reason: "The code is inactive",
      },
      {
        setup: "past their expiry date",
        given: { code: { expiresAt: NOW - 1 } },
        reason: "The code has expired",
      },
      {
        setup: "at their redemption limit",
        given: { code: { maxRedemptions: 3, timesRedeemed: 3 } },
        reason: "The code has reached its redemption limit",
      },
    ];

    /** @scenario "A code the Growth checkout refuses is flagged with the reason" */
    it.each(rows)("flags a code $setup", ({ given, reason }) => {
      const verdict = judge(given);

      expect(verdict.accepted).toBe(false);
      expect(verdict.reasons.map((r) => r.message)).toEqual([reason]);
    });

    it("refuses a code whose coupon is no longer valid or past its redeem-by date", () => {
      expect(judge({ coupon: { valid: false } }).reasons.map((r) => r.code)).toEqual(["inactive"]);
      expect(judge({ coupon: { redeemBy: NOW } }).reasons.map((r) => r.code)).toEqual(["expired"]);
    });

    it("names every reason a code fails on at once", () => {
      const verdict = judge({
        coupon: { percentOff: null, amountOff: 2900 },
        code: { firstTimeTransaction: true },
      });

      expect(verdict.reasons.map((r) => r.code)).toEqual(["amount_off", "first_time_only"]);
    });
  });

  describe("given a code with a minimum order amount", () => {
    /** @scenario "A minimum order amount is a warning measured on the prorated first charge" */
    it("accepts it with a warning about the prorated first charge", () => {
      const verdict = judge({ code: { minimumAmount: 5000, minimumAmountCurrency: "eur" } });

      expect(verdict.accepted).toBe(true);
      expect(verdict.warnings.map((w) => w.code)).toEqual(["minimum_amount"]);
      expect(verdict.warnings[0]?.message).toContain("prorated first charge");
    });
  });

  describe("given a code only one customer may redeem", () => {
    /** @scenario "A code limited to one customer is a warning, not a refusal" */
    it("accepts it with a warning that only that customer can redeem it", () => {
      const verdict = judge({ code: { customerId: "cus_one" } });

      expect(verdict.accepted).toBe(true);
      expect(verdict.warnings.map((w) => w.code)).toEqual(["single_customer"]);
    });
  });

  describe("given a percentage coupon on Growth Seats with an unrestricted code", () => {
    /** @scenario "A percentage code on Growth Seats with no restrictions is accepted" */
    it("accepts it with no reasons and no warnings", () => {
      expect(judge({})).toEqual({ accepted: true, reasons: [], warnings: [] });
    });

    it("accepts a coupon that limits no product at all", () => {
      expect(judge({ coupon: { products: null } }).accepted).toBe(true);
    });
  });
});

describe("nameCouponProducts", () => {
  it("names the Growth products and leaves any other as its id", () => {
    expect(
      nameCouponProducts({
        productIds: [PRODUCTS.seats, PRODUCTS.events, "prod_other"],
        products: PRODUCTS,
      }),
    ).toEqual([
      { id: PRODUCTS.seats, role: "growth_seats" },
      { id: PRODUCTS.events, role: "growth_events" },
      { id: "prod_other", role: null },
    ]);
  });
});

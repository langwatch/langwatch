// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @see enterprise/modules/billing/specs/coupons.feature */
import {
  type CreateCouponRequest,
  resolveGrowthCheckoutProducts,
  stripePricesFile,
} from "@langwatch/enterprise-billing-contract";
import { Temporal, type Instant } from "@langwatch/time";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { MemoryStripeCouponsChannel } from "../../channels/memory/memory.stripe-coupons.channel.ts";
import type { StripeCoupon, StripePromotionCode } from "../../channels/stripe-coupons.channel.ts";
import { BillingCouponService } from "../billing-coupon.service.ts";
import { StripeErrorTranslatorService } from "../stripe-error-translator.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-11-10T12:00:00Z");
const NOW_SECONDS = Math.floor(NOW.epochMilliseconds / 1000);
const PRODUCTS = resolveGrowthCheckoutProducts(stripePricesFile, "test");

const heldCoupon = (overrides: Partial<StripeCoupon> = {}): StripeCoupon => ({
  id: "coupon_half",
  name: "Half off",
  percentOff: 50,
  amountOff: null,
  currency: null,
  duration: "repeating",
  durationInMonths: 2,
  products: [PRODUCTS.seats],
  valid: true,
  timesRedeemed: 1,
  maxRedemptions: null,
  redeemBy: null,
  created: NOW_SECONDS - 1000,
  ...overrides,
});

const heldCode = (overrides: Partial<StripePromotionCode> = {}): StripePromotionCode => ({
  id: "promo_half",
  code: "HALF50",
  couponId: "coupon_half",
  active: true,
  timesRedeemed: 1,
  maxRedemptions: 10,
  expiresAt: NOW_SECONDS + 86_400,
  created: NOW_SECONDS - 900,
  customerId: null,
  firstTimeTransaction: false,
  minimumAmount: null,
  minimumAmountCurrency: null,
  ...overrides,
});

const REQUEST: CreateCouponRequest = {
  percentOff: 50,
  duration: "repeating",
  durationInMonths: 2,
  code: "WELCOME50",
};

function compose() {
  const channel = MemoryStripeCouponsChannel.create();
  const service = BillingCouponService.create({
    coupons: channel,
    products: PRODUCTS,
    stripeErrors: StripeErrorTranslatorService.create(),
    now: () => NOW,
  });
  return { channel, service };
}

async function refusalOf(promise: Promise<unknown>): Promise<{ code?: string; meta?: unknown }> {
  return promise.then(
    () => ({}),
    (error: { code?: string; meta?: unknown }) => error,
  );
}

describe("BillingCouponService", () => {
  describe("given the Growth products of the test Stripe mode", () => {
    it("reads them off the catalogue's Growth Seats and Growth Events prices", () => {
      expect(PRODUCTS).toEqual({ seats: "prod_Twquw4VLPAoYC1", events: "prod_U09JyXm95Yad65" });
      expect(resolveGrowthCheckoutProducts(stripePricesFile, "live")).toEqual({
        seats: "prod_TzxoIMJy1hzZc6",
        events: "prod_U0FxIOn91twEaC",
      });
    });
  });

  describe("when the operator lists coupons", () => {
    /** @scenario "Coupons and their promotion codes are listed" */
    it("answers each coupon newest first with its codes, terms and verdicts", async () => {
      const { channel, service } = compose();
      channel.seed({ coupon: heldCoupon(), codes: [heldCode()] });
      channel.seed({
        coupon: heldCoupon({
          id: "coupon_fixed",
          percentOff: null,
          amountOff: 2900,
          currency: "eur",
          created: NOW_SECONDS - 10,
        }),
        codes: [heldCode({ id: "promo_fixed", code: "FIXED29", couponId: "coupon_fixed" })],
      });

      const { coupons } = await service.list();

      expect(coupons.map((coupon) => coupon.id)).toEqual(["coupon_fixed", "coupon_half"]);
      const half = coupons[1];
      expect(half).toMatchObject({
        name: "Half off",
        percentOff: 50,
        duration: "repeating",
        durationInMonths: 2,
        products: [{ id: PRODUCTS.seats, role: "growth_seats" }],
      });
      expect(half?.codes).toEqual([
        expect.objectContaining({
          code: "HALF50",
          timesRedeemed: 1,
          maxRedemptions: 10,
          expiresAt: "2026-11-11T12:00:00Z",
          firstTimeTransaction: false,
          verdict: { accepted: true, reasons: [], warnings: [] },
        }),
      ]);
      expect(coupons[0]?.codes[0]?.verdict.reasons.map((reason) => reason.code)).toEqual([
        "amount_off",
      ]);
    });

    it("answers no product limit for a coupon that applies to every product", async () => {
      const { channel, service } = compose();
      channel.seed({ coupon: heldCoupon({ products: null }), codes: [heldCode()] });

      const { coupons } = await service.list();

      expect(coupons[0]?.products).toBeNull();
    });

    /** @scenario "The list fails clearly when Stripe is unreachable" */
    it("names the payment provider unavailable for the page to show", async () => {
      const { channel, service } = compose();
      channel.refuse({
        operation: "listCoupons",
        error: new Stripe.errors.StripeConnectionError({
          type: "api_error",
          message: "unreachable",
        }),
      });

      await expect(service.list()).rejects.toMatchObject({ code: "billing_provider_unavailable" });
    });
  });

  describe("when the operator creates a percentage coupon with a code", () => {
    /** @scenario "The operator creates a percentage coupon with a code" */
    it("makes a repeating percentage coupon on Growth Seats with an unrestricted code", async () => {
      const { channel, service } = compose();

      const created = await service.create(REQUEST);

      expect(channel.coupons).toEqual([
        expect.objectContaining({
          percentOff: 50,
          amountOff: null,
          duration: "repeating",
          durationInMonths: 2,
          products: [PRODUCTS.seats],
        }),
      ]);
      expect(channel.codes).toEqual([
        expect.objectContaining({ code: "WELCOME50", firstTimeTransaction: false }),
      ]);
      expect(created.codes[0]?.verdict.accepted).toBe(true);
      const { coupons } = await service.list();
      expect(coupons[0]?.id).toBe(created.id);
    });

    /** @scenario "The coupon may also cover event usage" */
    it("limits the coupon to Growth Seats and Growth Events when asked", async () => {
      const { channel, service } = compose();

      await service.create({ ...REQUEST, includeEvents: true });

      expect(channel.coupons[0]?.products).toEqual([PRODUCTS.seats, PRODUCTS.events]);
    });

    /** @scenario "A code may be capped and given an expiry" */
    it("puts the redemption cap and the expiry on the promotion code", async () => {
      const { channel, service } = compose();

      await service.create({ ...REQUEST, maxRedemptions: 10, expiresAt: "2026-12-31T23:59:59Z" });

      expect(channel.codes[0]).toMatchObject({
        maxRedemptions: 10,
        expiresAt: Math.floor(Date.parse("2026-12-31T23:59:59Z") / 1000),
      });
    });
  });

  describe("when the request is invalid", () => {
    const rows: { input: string; request: CreateCouponRequest; field: string }[] = [
      { input: "0% off", request: { ...REQUEST, percentOff: 0 }, field: "percentOff" },
      { input: "101% off", request: { ...REQUEST, percentOff: 101 }, field: "percentOff" },
      {
        input: "a repeating coupon with no months",
        request: { ...REQUEST, durationInMonths: undefined },
        field: "durationInMonths",
      },
      {
        input: "a repeating coupon of 48 months",
        request: { ...REQUEST, durationInMonths: 48 },
        field: "durationInMonths",
      },
      { input: 'the code "half off!"', request: { ...REQUEST, code: "half off!" }, field: "code" },
      {
        input: "an expiry date in the past",
        request: { ...REQUEST, expiresAt: "2026-11-01T00:00:00Z" },
        field: "expiresAt",
      },
    ];

    /** @scenario "An invalid coupon is refused before it reaches Stripe" */
    it.each(rows)("refuses $input by field and creates nothing", async ({ request, field }) => {
      const { channel, service } = compose();

      const refusal = await refusalOf(service.create(request));

      expect(refusal.code).toBe("billing_coupon_invalid");
      expect(refusal.meta).toEqual({ fieldErrors: { [field]: [expect.any(String)] } });
      expect(channel.coupons).toEqual([]);
      expect(channel.codes).toEqual([]);
    });
  });

  describe("when the code is already held by an active promotion code", () => {
    /** @scenario "A code already taken by an active promotion code is refused by name" */
    it("refuses by name, whatever the case, and leaves no coupon behind", async () => {
      const { channel, service } = compose();
      channel.seed({ coupon: heldCoupon(), codes: [heldCode({ code: "WELCOME50" })] });

      const refusal = await refusalOf(service.create({ ...REQUEST, code: "welcome50" }));

      expect(refusal).toMatchObject({
        code: "billing_coupon_code_taken",
        meta: { code: "welcome50" },
      });
      expect(channel.coupons.map((coupon) => coupon.id)).toEqual(["coupon_half"]);
    });

    it("deletes the new coupon again when Stripe refuses its code", async () => {
      const { channel, service } = compose();
      channel.refuse({
        operation: "createPromotionCode",
        error: new Stripe.errors.StripeInvalidRequestError({
          type: "invalid_request_error",
          message: "taken",
        }),
      });

      await expect(service.create(REQUEST)).rejects.toMatchObject({
        type: "StripeInvalidRequestError",
      });
      expect(channel.coupons).toEqual([]);
    });

    it("refuses by name when another operator takes the code between the check and the write", async () => {
      const { channel, service } = compose();
      channel.refuse({
        operation: "createPromotionCode",
        error: new Stripe.errors.StripeInvalidRequestError({
          type: "invalid_request_error",
          code: "promotion_code_already_exists",
          message: "taken",
        }),
      });

      const refusal = await refusalOf(service.create(REQUEST));

      expect(refusal.code).toBe("billing_coupon_code_taken");
      expect(channel.coupons).toEqual([]);
    });

    it("keeps Stripe's refusal of the code when deleting the coupon also fails", async () => {
      const { channel, service } = compose();
      channel.refuse({
        operation: "createPromotionCode",
        error: new Stripe.errors.StripeInvalidRequestError({
          type: "invalid_request_error",
          message: "code refused",
        }),
      });
      channel.refuse({ operation: "deleteCoupon", error: new Error("delete refused") });

      await expect(service.create(REQUEST)).rejects.toMatchObject({ message: "code refused" });
    });
  });

  describe("when the operator deactivates a promotion code", () => {
    /** @scenario "The operator deactivates a promotion code" */
    it("marks it inactive, and the name may be taken by a new coupon", async () => {
      const { channel, service } = compose();
      channel.seed({ coupon: heldCoupon(), codes: [heldCode({ code: "DISCOUNTCS" })] });

      await service.deactivateCode({ promotionCodeId: "promo_half" });
      await service.create({ ...REQUEST, code: "DISCOUNTCS" });

      expect(channel.codes.map(({ code, active }) => ({ code, active }))).toEqual([
        { code: "DISCOUNTCS", active: false },
        { code: "DISCOUNTCS", active: true },
      ]);
    });
  });
});

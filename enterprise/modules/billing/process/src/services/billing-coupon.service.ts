// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Cloud admin console's Stripe coupons: every coupon with its codes, each judged
 * against the Growth checkout, and the one kind of coupon that checkout takes (a
 * percentage limited to the Growth products, with an unrestricted code). See coupons.feature.
 */

import {
  BillingCouponCodeTakenError,
  BillingCouponInvalidError,
  type CouponList,
  type CouponView,
  type CreateCouponRequest,
  findCouponRequestProblems,
  type GrowthCheckoutProducts,
  type PromotionCodeTarget,
} from "@langwatch/enterprise-billing-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import Stripe from "stripe";

import type {
  StripeCoupon,
  StripeCouponsChannel,
  StripePromotionCode,
} from "../channels/stripe-coupons.channel.ts";
import {
  judgePromotionCode,
  nameCouponProducts,
} from "../rules/coupon-checkout-compatibility.rules.ts";
import type { StripeErrorTranslator } from "./stripe-error-translator.service.ts";

export class BillingCouponService {
  readonly #coupons: StripeCouponsChannel;
  readonly #products: GrowthCheckoutProducts;
  readonly #stripeErrors: StripeErrorTranslator;
  readonly #now: () => Instant;

  private constructor({
    coupons,
    products,
    stripeErrors,
    now,
  }: {
    coupons: StripeCouponsChannel;
    products: GrowthCheckoutProducts;
    stripeErrors: StripeErrorTranslator;
    now: () => Instant;
  }) {
    this.#coupons = coupons;
    this.#products = products;
    this.#stripeErrors = stripeErrors;
    this.#now = now;
  }

  static create(input: {
    coupons: StripeCouponsChannel;
    /** The Growth Seats and Events products of the deployment's Stripe mode. */
    products: GrowthCheckoutProducts;
    stripeErrors: StripeErrorTranslator;
    now?: () => Instant;
  }): BillingCouponService {
    return new BillingCouponService({
      coupons: input.coupons,
      products: input.products,
      stripeErrors: input.stripeErrors,
      now: input.now ?? nowInstant,
    });
  }

  /** Every coupon, newest first, each with its codes newest first. */
  async list(): Promise<CouponList> {
    const [coupons, codes] = await this.#calling(() =>
      Promise.all([this.#coupons.listCoupons(), this.#coupons.listPromotionCodes()]),
    );
    const now = this.#nowSeconds();
    const views = coupons
      .toSorted((a, b) => b.created - a.created)
      .map((coupon) =>
        this.#view({
          coupon,
          codes: codes.filter((code) => code.couponId === coupon.id),
          now,
        }),
      );
    return { coupons: views };
  }

  /**
   * A percentage coupon on Growth Seats (and Events when asked) with its code. The coupon
   * is deleted again when its code cannot be made, so no coupon is left without one.
   */
  async create(request: CreateCouponRequest): Promise<CouponView> {
    const problems = findCouponRequestProblems({ request, now: this.#now() });
    if (problems.length > 0) {
      const fieldErrors: Record<string, string[]> = {};
      for (const { field, message } of problems) (fieldErrors[field] ??= []).push(message);
      throw new BillingCouponInvalidError(fieldErrors);
    }
    const existing = await this.#calling(() => this.#coupons.listPromotionCodes());
    const wanted = request.code.toLowerCase();
    if (existing.some((code) => code.active && code.code.toLowerCase() === wanted)) {
      throw new BillingCouponCodeTakenError(request.code);
    }

    const products = request.includeEvents
      ? [this.#products.seats, this.#products.events]
      : [this.#products.seats];
    const coupon = await this.#calling(() =>
      this.#coupons.createCoupon({
        name: request.name || undefined,
        percentOff: request.percentOff,
        duration: request.duration,
        durationInMonths: request.duration === "repeating" ? request.durationInMonths : undefined,
        products,
      }),
    );
    let code: StripePromotionCode;
    try {
      code = await this.#coupons.createPromotionCode({
        couponId: coupon.id,
        code: request.code,
        maxRedemptions: request.maxRedemptions,
        expiresAt: request.expiresAt
          ? Math.floor(Temporal.Instant.from(request.expiresAt).epochMilliseconds / 1000)
          : undefined,
      });
    } catch (failure) {
      // Best-effort cleanup: the operator needs why the code failed, not why the delete did.
      await this.#coupons.deleteCoupon({ couponId: coupon.id }).catch(() => undefined);
      if (isCodeTaken(failure)) throw new BillingCouponCodeTakenError(request.code);
      throw this.#stripeErrors.translate(failure);
    }
    return this.#view({ coupon, codes: [code], now: this.#nowSeconds() });
  }

  async deactivateCode(input: PromotionCodeTarget): Promise<PromotionCodeTarget> {
    await this.#calling(() => this.#coupons.deactivatePromotionCode(input));
    return { promotionCodeId: input.promotionCodeId };
  }

  #view({
    coupon,
    codes,
    now,
  }: {
    coupon: StripeCoupon;
    codes: readonly StripePromotionCode[];
    now: number;
  }): CouponView {
    const products = this.#products;
    return {
      id: coupon.id,
      name: coupon.name,
      percentOff: coupon.percentOff,
      amountOff: coupon.amountOff,
      currency: coupon.currency,
      duration: coupon.duration,
      durationInMonths: coupon.durationInMonths,
      products: coupon.products
        ? nameCouponProducts({ productIds: coupon.products, products })
        : null,
      valid: coupon.valid,
      timesRedeemed: coupon.timesRedeemed,
      maxRedemptions: coupon.maxRedemptions,
      redeemBy: coupon.redeemBy === null ? null : isoAt(coupon.redeemBy),
      createdAt: isoAt(coupon.created),
      codes: codes
        .toSorted((a, b) => b.created - a.created)
        .map((code) => ({
          id: code.id,
          code: code.code,
          active: code.active,
          timesRedeemed: code.timesRedeemed,
          maxRedemptions: code.maxRedemptions,
          expiresAt: code.expiresAt === null ? null : isoAt(code.expiresAt),
          createdAt: isoAt(code.created),
          firstTimeTransaction: code.firstTimeTransaction,
          minimumAmount: code.minimumAmount,
          minimumAmountCurrency: code.minimumAmountCurrency,
          customerId: code.customerId,
          verdict: judgePromotionCode({ coupon, code, products, now }),
        })),
    };
  }

  /** Runs a Stripe call; a rate limit or an unreachable Stripe names the provider unavailable. */
  async #calling<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw this.#stripeErrors.translate(error);
    }
  }

  #nowSeconds(): number {
    return Math.floor(this.#now().epochMilliseconds / 1000);
  }
}

/** Stripe refused the code because an active one already holds it, taken since the check. */
function isCodeTaken(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === "promotion_code_already_exists"
  );
}

/** Stripe's epoch seconds as an ISO instant. */
function isoAt(seconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(seconds * 1000).toString();
}

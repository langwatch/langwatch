// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import Stripe from "stripe";

import {
  type NewStripeCoupon,
  type NewStripePromotionCode,
  type StripeCoupon,
  StripeCouponsChannel,
  type StripePromotionCode,
} from "../stripe-coupons.channel.ts";

type Operation = keyof StripeCouponsChannel;

/**
 * Stripe's coupons where no provider is composed: holds what a test seeds or creates,
 * in that order, and refuses an id it never held or a taken active code as Stripe does.
 */
export class MemoryStripeCouponsChannel extends StripeCouponsChannel {
  readonly coupons: StripeCoupon[] = [];
  readonly codes: StripePromotionCode[] = [];
  private readonly refusals = new Map<Operation, Error>();
  private sequence = 0;
  private clock = 1_800_000_000;

  private constructor() {
    super();
  }

  static create(): MemoryStripeCouponsChannel {
    return new MemoryStripeCouponsChannel();
  }

  /** Puts a coupon, and any codes on it, in the account. */
  seed({ coupon, codes = [] }: { coupon: StripeCoupon; codes?: StripePromotionCode[] }): void {
    this.coupons.push(coupon);
    this.codes.push(...codes);
  }

  /** Makes `operation` throw `error` from now on, as a failing provider would. */
  refuse({ operation, error }: { operation: Operation; error: Error }): void {
    this.refusals.set(operation, error);
  }

  async listCoupons(): Promise<StripeCoupon[]> {
    this.#refusing("listCoupons");
    return [...this.coupons];
  }

  async listPromotionCodes(): Promise<StripePromotionCode[]> {
    this.#refusing("listPromotionCodes");
    return [...this.codes];
  }

  async createCoupon(input: NewStripeCoupon): Promise<StripeCoupon> {
    this.#refusing("createCoupon");
    const coupon: StripeCoupon = {
      id: `coupon_${++this.sequence}`,
      name: input.name ?? null,
      percentOff: input.percentOff,
      amountOff: null,
      currency: null,
      duration: input.duration,
      durationInMonths: input.duration === "repeating" ? (input.durationInMonths ?? null) : null,
      products: [...input.products],
      valid: true,
      timesRedeemed: 0,
      maxRedemptions: null,
      redeemBy: null,
      created: this.#tick(),
    };
    this.coupons.push(coupon);
    return coupon;
  }

  async createPromotionCode(input: NewStripePromotionCode): Promise<StripePromotionCode> {
    this.#refusing("createPromotionCode");
    this.#indexOfCoupon(input.couponId);
    const taken = this.codes.some(
      (held) => held.active && held.code.toLowerCase() === input.code.toLowerCase(),
    );
    if (taken) {
      throw new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "promotion_code_already_exists",
        message: "An active promotion code with `code` already exists.",
      });
    }
    const code: StripePromotionCode = {
      id: `promo_${++this.sequence}`,
      code: input.code,
      couponId: input.couponId,
      active: true,
      timesRedeemed: 0,
      maxRedemptions: input.maxRedemptions ?? null,
      expiresAt: input.expiresAt ?? null,
      created: this.#tick(),
      customerId: null,
      firstTimeTransaction: false,
      minimumAmount: null,
      minimumAmountCurrency: null,
    };
    this.codes.push(code);
    return code;
  }

  async deleteCoupon({ couponId }: { couponId: string }): Promise<void> {
    this.#refusing("deleteCoupon");
    this.coupons.splice(this.#indexOfCoupon(couponId), 1);
  }

  async deactivatePromotionCode({ promotionCodeId }: { promotionCodeId: string }): Promise<void> {
    this.#refusing("deactivatePromotionCode");
    const index = this.codes.findIndex((code) => code.id === promotionCodeId);
    const held = this.codes[index];
    if (!held) throw missing("promotion code", promotionCodeId);
    this.codes[index] = { ...held, active: false };
  }

  #refusing(operation: Operation): void {
    const refusal = this.refusals.get(operation);
    if (refusal) throw refusal;
  }

  #indexOfCoupon(couponId: string): number {
    const index = this.coupons.findIndex((coupon) => coupon.id === couponId);
    if (index < 0) throw missing("coupon", couponId);
    return index;
  }

  #tick(): number {
    this.clock += 1;
    return this.clock;
  }
}

function missing(kind: string, id: string): Error {
  return new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message: `No such ${kind}: '${id}'`,
  });
}

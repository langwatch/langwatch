// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type Stripe from "stripe";

import {
  type NewStripeCoupon,
  type NewStripePromotionCode,
  type StripeCoupon,
  StripeCouponsChannel,
  type StripePromotionCode,
} from "../stripe-coupons.channel.ts";

/** Stripe's largest page. */
const PAGE_SIZE = 100;

/** Stripe's coupons and promotion codes over billing's one client. */
export class HttpStripeCouponsChannel extends StripeCouponsChannel {
  private constructor(private readonly stripe: Stripe) {
    super();
  }

  static create(input: { stripe: Stripe }): HttpStripeCouponsChannel {
    return new HttpStripeCouponsChannel(input.stripe);
  }

  async listCoupons(): Promise<StripeCoupon[]> {
    const coupons = await everyPage((startingAfter) =>
      this.stripe.coupons.list({
        limit: PAGE_SIZE,
        starting_after: startingAfter,
        expand: ["data.applies_to"],
      }),
    );
    return coupons.map(toCoupon);
  }

  async listPromotionCodes(): Promise<StripePromotionCode[]> {
    const codes = await everyPage((startingAfter) =>
      this.stripe.promotionCodes.list({ limit: PAGE_SIZE, starting_after: startingAfter }),
    );
    return codes.map(toPromotionCode);
  }

  async createCoupon(input: NewStripeCoupon): Promise<StripeCoupon> {
    const coupon = await this.stripe.coupons.create({
      name: input.name,
      percent_off: input.percentOff,
      duration: input.duration,
      duration_in_months: input.duration === "repeating" ? input.durationInMonths : undefined,
      applies_to: { products: [...input.products] },
      expand: ["applies_to"],
    });
    return toCoupon(coupon);
  }

  async createPromotionCode(input: NewStripePromotionCode): Promise<StripePromotionCode> {
    const code = await this.stripe.promotionCodes.create({
      coupon: input.couponId,
      code: input.code,
      max_redemptions: input.maxRedemptions,
      expires_at: input.expiresAt,
      restrictions: { first_time_transaction: false },
    });
    return toPromotionCode(code);
  }

  async deleteCoupon({ couponId }: { couponId: string }): Promise<void> {
    await this.stripe.coupons.del(couponId);
  }

  async deactivatePromotionCode({ promotionCodeId }: { promotionCodeId: string }): Promise<void> {
    await this.stripe.promotionCodes.update(promotionCodeId, { active: false });
  }
}

/** At 100 items a page, 100 pages is 10,000 coupons or codes: far past any real account. */
const MAX_PAGES = 100;

/** Every item of a listing, following Stripe's cursor to the end. */
async function everyPage<T extends { id: string }>(
  page: (startingAfter: string | undefined) => Promise<Stripe.ApiList<T>>,
): Promise<T[]> {
  const all: T[] = [];
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const { data, has_more: hasMore } = await page(startingAfter);
    all.push(...data);
    const last = data.at(-1);
    if (!hasMore || !last) return all;
    startingAfter = last.id;
  }
  throw new Error(`Stripe listing ran past ${MAX_PAGES} pages`);
}

function toCoupon(coupon: Stripe.Coupon): StripeCoupon {
  return {
    id: coupon.id,
    name: coupon.name,
    percentOff: coupon.percent_off,
    amountOff: coupon.amount_off,
    currency: coupon.currency,
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months,
    products: coupon.applies_to ? [...coupon.applies_to.products] : null,
    valid: coupon.valid,
    timesRedeemed: coupon.times_redeemed,
    maxRedemptions: coupon.max_redemptions,
    redeemBy: coupon.redeem_by,
    created: coupon.created,
  };
}

function toPromotionCode(code: Stripe.PromotionCode): StripePromotionCode {
  const customer = code.customer;
  return {
    id: code.id,
    code: code.code,
    couponId: code.coupon.id,
    active: code.active,
    timesRedeemed: code.times_redeemed,
    maxRedemptions: code.max_redemptions,
    expiresAt: code.expires_at,
    created: code.created,
    customerId: typeof customer === "string" ? customer : (customer?.id ?? null),
    firstTimeTransaction: code.restrictions.first_time_transaction,
    minimumAmount: code.restrictions.minimum_amount,
    minimumAmountCurrency: code.restrictions.minimum_amount_currency,
  };
}

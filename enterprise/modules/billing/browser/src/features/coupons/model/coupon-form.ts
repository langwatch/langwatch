// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The create-coupon drawer's draft, how it becomes a request, and how coupons read on screen. */

import {
  type CouponDuration,
  type CouponInputProblem,
  type CouponProduct,
  type CouponView,
  type CreateCouponRequest,
  findCouponRequestProblems,
} from "@langwatch/enterprise-billing-contract";
import type { Instant } from "@langwatch/time";

export type CouponDraft = {
  percentOff: string;
  duration: CouponDuration;
  durationInMonths: string;
  name: string;
  code: string;
  includeEvents: boolean;
  maxRedemptions: string;
  /** A calendar date (YYYY-MM-DD); the code lasts to the end of that day, UTC. */
  expiresOn: string;
};

export type CouponField = CouponInputProblem["field"];
export type CouponProblems = Partial<Record<CouponField, string>>;

export function emptyCouponDraft(): CouponDraft {
  return {
    percentOff: "",
    duration: "repeating",
    durationInMonths: "2",
    name: "",
    code: "",
    includeEvents: false,
    maxRedemptions: "",
    expiresOn: "",
  };
}

const numberOrUndefined = (value: string): number | undefined =>
  value.trim() === "" ? undefined : Number(value);

/** The request the drawer sends; validation is the shared rule's, not this function's. */
export function couponRequestFrom(draft: CouponDraft): CreateCouponRequest {
  const name = draft.name.trim();
  return {
    percentOff: Number(draft.percentOff),
    duration: draft.duration,
    ...(draft.duration === "repeating"
      ? { durationInMonths: numberOrUndefined(draft.durationInMonths) }
      : {}),
    ...(name ? { name } : {}),
    code: draft.code.trim(),
    includeEvents: draft.includeEvents,
    ...(draft.maxRedemptions.trim() === ""
      ? {}
      : { maxRedemptions: Number(draft.maxRedemptions) }),
    ...(draft.expiresOn ? { expiresAt: `${draft.expiresOn}T23:59:59Z` } : {}),
  };
}

/** The first problem with each field, as the shared rule names it. */
export function couponProblemsOf({ draft, now }: { draft: CouponDraft; now: Instant }): CouponProblems {
  const problems: CouponProblems = {};
  for (const { field, message } of findCouponRequestProblems({
    request: couponRequestFrom(draft),
    now,
  })) {
    problems[field] ??= message;
  }
  return problems;
}

/** "50% off" or "€29.00 off". */
export function discountLabel(coupon: Pick<CouponView, "percentOff" | "amountOff" | "currency">) {
  if (coupon.percentOff !== null) return `${coupon.percentOff}% off`;
  if (coupon.amountOff !== null && coupon.currency) {
    const amount = new Intl.NumberFormat("en", {
      style: "currency",
      currency: coupon.currency.toUpperCase(),
    }).format(coupon.amountOff / 100);
    return `${amount} off`;
  }
  return "No discount";
}

/** "Once", "For 2 months" or "Forever". */
export function durationLabel(coupon: Pick<CouponView, "duration" | "durationInMonths">) {
  if (coupon.duration === "once") return "Once";
  if (coupon.duration === "forever") return "Forever";
  const months = coupon.durationInMonths ?? 0;
  return `For ${months} ${months === 1 ? "month" : "months"}`;
}

const PRODUCT_NAMES = { growth_seats: "Growth Seats", growth_events: "Growth Events" } as const;

/** The products a coupon is limited to, Growth ones by name; "All products" when unlimited. */
export function productsLabel(products: readonly CouponProduct[] | null): string {
  if (!products) return "All products";
  if (products.length === 0) return "No products";
  return products.map((product) => (product.role ? PRODUCT_NAMES[product.role] : product.id)).join(", ");
}

/** "3 of 10" or "3". */
export function redemptionsLabel(held: { timesRedeemed: number; maxRedemptions: number | null }) {
  return held.maxRedemptions === null
    ? String(held.timesRedeemed)
    : `${held.timesRedeemed} of ${held.maxRedemptions}`;
}

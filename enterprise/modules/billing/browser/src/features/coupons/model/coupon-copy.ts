// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** How a coupon and its codes read in the coupons table. */

import type { CouponProduct, CouponView } from "@langwatch/enterprise-billing-contract";

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
  return products
    .map((product) => (product.role ? PRODUCT_NAMES[product.role] : product.id))
    .join(", ");
}

/** "3 of 10" or "3". */
export function redemptionsLabel(held: { timesRedeemed: number; maxRedemptions: number | null }) {
  return held.maxRedemptions === null
    ? String(held.timesRedeemed)
    : `${held.timesRedeemed} of ${held.maxRedemptions}`;
}

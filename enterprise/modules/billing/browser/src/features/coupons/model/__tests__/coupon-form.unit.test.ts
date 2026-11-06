/** @see enterprise/modules/billing/specs/coupons.feature */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  couponProblemsOf,
  couponRequestFrom,
  discountLabel,
  durationLabel,
  emptyCouponDraft,
  productsLabel,
  redemptionsLabel,
  type CouponDraft,
} from "../coupon-form.ts";

const draft = (overrides: Partial<CouponDraft> = {}): CouponDraft => ({
  ...emptyCouponDraft(),
  percentOff: "50",
  code: "WELCOME50",
  ...overrides,
});

describe("the create-coupon form", () => {
  describe("when the drawer's draft becomes a request", () => {
    it("sends only the fields the operator filled", () => {
      expect(couponRequestFrom(draft({ name: "  ", code: " WELCOME50 " }))).toEqual({
        percentOff: 50,
        duration: "repeating",
        durationInMonths: 2,
        code: "WELCOME50",
        includeEvents: false,
      });
    });

    it("sends the name, the redemption cap and the expiry at the end of that day, UTC", () => {
      expect(
        couponRequestFrom(
          draft({ name: " Launch ", maxRedemptions: "10", expiresOn: "2026-12-31" }),
        ),
      ).toMatchObject({
        name: "Launch",
        maxRedemptions: 10,
        expiresAt: "2026-12-31T23:59:59Z",
      });
    });

    it("leaves the month count out of a coupon that is not repeating", () => {
      expect(couponRequestFrom(draft({ duration: "forever" }))).not.toHaveProperty(
        "durationInMonths",
      );
    });
  });

  describe("when the draft is checked", () => {
    const now = Temporal.Instant.from("2026-11-10T12:00:00Z");

    it("tells a missing month count from one past the three-year cap", () => {
      expect(couponProblemsOf({ draft: draft({ durationInMonths: "" }), now })).toEqual({
        durationInMonths: "Say how many months the discount lasts",
      });
      expect(couponProblemsOf({ draft: draft({ durationInMonths: "48" }), now })).toEqual({
        durationInMonths: "Use a whole number of months from 1 to 36",
      });
    });
  });
});

describe("how a coupon reads on screen", () => {
  it("names a percentage, an amount in its currency, or no discount", () => {
    expect(discountLabel({ percentOff: 50, amountOff: null, currency: null })).toBe("50% off");
    expect(discountLabel({ percentOff: null, amountOff: 2900, currency: "eur" })).toBe(
      "€29.00 off",
    );
    expect(discountLabel({ percentOff: null, amountOff: null, currency: null })).toBe(
      "No discount",
    );
  });

  it("names how long the discount lasts, with one month singular", () => {
    expect(durationLabel({ duration: "once", durationInMonths: null })).toBe("Once");
    expect(durationLabel({ duration: "forever", durationInMonths: null })).toBe("Forever");
    expect(durationLabel({ duration: "repeating", durationInMonths: 1 })).toBe("For 1 month");
    expect(durationLabel({ duration: "repeating", durationInMonths: 3 })).toBe("For 3 months");
  });

  it("names the Growth products and shows any other product by id", () => {
    expect(productsLabel(null)).toBe("All products");
    expect(productsLabel([])).toBe("No products");
    expect(
      productsLabel([
        { id: "prod_seats", role: "growth_seats" },
        { id: "prod_events", role: "growth_events" },
        { id: "prod_other", role: null },
      ]),
    ).toBe("Growth Seats, Growth Events, prod_other");
  });

  it("shows redemptions against the cap, or alone when there is none", () => {
    expect(redemptionsLabel({ timesRedeemed: 3, maxRedemptions: 10 })).toBe("3 of 10");
    expect(redemptionsLabel({ timesRedeemed: 3, maxRedemptions: null })).toBe("3");
  });
});

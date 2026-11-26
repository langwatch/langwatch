/**
 * The currency Strict's price is quoted in: the subscription's, read off its Growth plan type.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import { describe, expect, it } from "vitest";

import { billingCurrencyOf } from "../privacy-billing-currency.ts";

const answered = (type: string) => ({ isLoading: false, isError: false, data: { type } });

describe("billingCurrencyOf()", () => {
  describe("when the plan is still loading", () => {
    /** @scenario "The price currency is the subscription's, read from its Growth plan" */
    it("answers loading, so no dollar price is quoted before the plan says euros", () => {
      expect(
        billingCurrencyOf({
          mayRead: true,
          plan: { isLoading: true, isError: false, data: undefined },
        }),
      ).toBe("loading");
    });
  });

  describe("when the active plan is a euro Growth seat plan", () => {
    /** @scenario "The price currency is the subscription's, read from its Growth plan" */
    it.each(["GROWTH_SEAT_EUR_MONTHLY", "GROWTH_SEAT_EUR_ANNUAL"])("quotes euros on %s", (type) => {
      expect(billingCurrencyOf({ mayRead: true, plan: answered(type) })).toBe("EUR");
    });
  });

  describe("when the plan is in dollars, another plan, unread or unreadable", () => {
    /** @scenario "The price currency is the subscription's, read from its Growth plan" */
    it("quotes dollars", () => {
      expect(billingCurrencyOf({ mayRead: true, plan: answered("GROWTH_SEAT_USD_MONTHLY") })).toBe(
        "USD",
      );
      expect(billingCurrencyOf({ mayRead: true, plan: answered("FREE") })).toBe("USD");
      expect(
        billingCurrencyOf({
          mayRead: true,
          plan: { isLoading: false, isError: true, data: { type: "GROWTH_SEAT_EUR_MONTHLY" } },
        }),
      ).toBe("USD");
      expect(billingCurrencyOf({ mayRead: false, plan: answered("GROWTH_SEAT_EUR_MONTHLY") })).toBe(
        "USD",
      );
    });
  });
});

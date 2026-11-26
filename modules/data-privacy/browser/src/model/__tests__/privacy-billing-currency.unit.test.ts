/**
 * The currency Strict's price is quoted in: the subscription's, read off its Growth plan type.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import { describe, expect, it } from "vitest";

import { billingCurrencyOf, mayReadSubscriptionPlan } from "../privacy-billing-currency.ts";

const answered = (type: string) => ({ isLoading: false, isError: false, data: { type } });

describe("mayReadSubscriptionPlan()", () => {
  const reader = { isSaaS: true, organizationId: "org-1", canViewOrganization: true };

  describe("when a reader who may view the organization opens the page on Cloud", () => {
    /** @scenario "The page reads the subscription's plan only on Cloud, for a reader allowed to" */
    it("reads the plan", () => {
      expect(mayReadSubscriptionPlan(reader)).toBe(true);
    });
  });

  describe("when the deployment is self-hosted, no organization is in scope, or the reader may not view it", () => {
    /** @scenario "The page reads the subscription's plan only on Cloud, for a reader allowed to" */
    it.each([
      ["self-hosted", { ...reader, isSaaS: false }],
      ["no organization", { ...reader, organizationId: undefined }],
      ["no organization:view", { ...reader, canViewOrganization: false }],
    ])("does not read it: %s", (_case, input) => {
      expect(mayReadSubscriptionPlan(input)).toBe(false);
    });
  });
});

describe("billingCurrencyOf()", () => {
  describe("when the plan is still loading, failed to read or answered nothing", () => {
    /** @scenario "The price currency is the subscription's, read from its Growth plan" */
    it.each([
      ["loading", { isLoading: true, isError: false, data: undefined }],
      ["failed", { isLoading: false, isError: true, data: { type: "GROWTH_SEAT_EUR_MONTHLY" } }],
      ["empty", { isLoading: false, isError: false, data: undefined }],
    ])("answers unknown when %s, so no currency is quoted", (_case, plan) => {
      expect(billingCurrencyOf({ mayRead: true, plan })).toBe("unknown");
    });
  });

  describe("when the active plan is a euro Growth seat plan", () => {
    /** @scenario "The price currency is the subscription's, read from its Growth plan" */
    it.each(["GROWTH_SEAT_EUR_MONTHLY", "GROWTH_SEAT_EUR_ANNUAL"])("quotes euros on %s", (type) => {
      expect(billingCurrencyOf({ mayRead: true, plan: answered(type) })).toBe("EUR");
    });
  });

  describe("when the plan is in dollars, another plan, or one the reader may not read", () => {
    /** @scenario "The price currency is the subscription's, read from its Growth plan" */
    it("quotes dollars", () => {
      expect(billingCurrencyOf({ mayRead: true, plan: answered("GROWTH_SEAT_USD_MONTHLY") })).toBe(
        "USD",
      );
      expect(billingCurrencyOf({ mayRead: true, plan: answered("FREE") })).toBe("USD");
      expect(billingCurrencyOf({ mayRead: false, plan: answered("GROWTH_SEAT_EUR_MONTHLY") })).toBe(
        "USD",
      );
    });
  });
});

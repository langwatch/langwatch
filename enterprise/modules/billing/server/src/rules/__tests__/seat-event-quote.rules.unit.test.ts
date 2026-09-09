/**
 * A seat quote has to reproduce the number the customer read, not merely resemble it. Three
 * rules make that hold: the two money figures come off the previewed invoice the same way
 * every time, the change is applied at the instant it was priced, and a quote older than its
 * validity window is refused rather than repriced silently.
 */
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuoteExpiredError } from "@langwatch/enterprise-billing-contract";
import {
  QUOTE_VALIDITY_SECONDS,
  quotedAmounts,
  resolveProrationDate,
  seatChangeParams,
} from "../seat-event-quote.rules.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("quotedAmounts", () => {
  describe("when the change costs the customer money", () => {
    it("reports the amount actually due and the credit that covered the rest", () => {
      expect(quotedAmounts({ total: 5000, amount_due: 3000 } as Stripe.Invoice)).toEqual({
        prorationCents: 3000,
        creditAppliedCents: 2000,
      });
    });

    it("reports no credit applied on a clean account", () => {
      expect(quotedAmounts({ total: 5000, amount_due: 5000 } as Stripe.Invoice)).toEqual({
        prorationCents: 5000,
        creditAppliedCents: 0,
      });
    });
  });

  describe("when the change credits the customer", () => {
    it("reports the signed total and draws no credit down", () => {
      expect(quotedAmounts({ total: -2500, amount_due: 0 } as Stripe.Invoice)).toEqual({
        prorationCents: -2500,
        creditAppliedCents: 0,
      });
    });
  });
});

describe("seatChangeParams", () => {
  const seatItem = { id: "si_1" } as Stripe.SubscriptionItem;

  it("prices the change at the quoted instant and invoices it immediately", () => {
    expect(
      seatChangeParams({
        stripeSubscription: { canceled_at: null } as Stripe.Subscription,
        seatItem,
        quantity: 7,
        prorationDate: 1_700_000_000,
      }),
    ).toEqual({
      items: [{ id: "si_1", quantity: 7 }],
      proration_behavior: "always_invoice",
      proration_date: 1_700_000_000,
    });
  });

  describe("when the subscription was set to cancel", () => {
    it("also lifts the cancellation, so the seats bought are actually billed", () => {
      const params = seatChangeParams({
        stripeSubscription: { canceled_at: 1_699_000_000 } as Stripe.Subscription,
        seatItem,
        quantity: 2,
        prorationDate: 1_700_000_000,
      });

      expect(params.cancel_at_period_end).toBe(false);
    });
  });
});

describe("resolveProrationDate", () => {
  const nowSeconds = 1_700_000_000;

  describe("when no quote was issued", () => {
    it("prices at the current instant", () => {
      vi.useFakeTimers();
      vi.setSystemTime(nowSeconds * 1000);

      expect(resolveProrationDate(undefined)).toBe(nowSeconds);
    });
  });

  describe("when the quote is still inside its validity window", () => {
    it("prices at the instant the quote was issued", () => {
      vi.useFakeTimers();
      vi.setSystemTime(nowSeconds * 1000);
      const quotedAt = nowSeconds - QUOTE_VALIDITY_SECONDS + 1;

      expect(resolveProrationDate(quotedAt)).toBe(quotedAt);
    });
  });

  describe("when the quote has aged out", () => {
    it("refuses rather than charging a different amount than the one shown", () => {
      vi.useFakeTimers();
      vi.setSystemTime(nowSeconds * 1000);

      expect(() => resolveProrationDate(nowSeconds - QUOTE_VALIDITY_SECONDS - 1)).toThrow(
        QuoteExpiredError,
      );
    });
  });

  describe("when the quote claims to have been issued in the future", () => {
    it("refuses it", () => {
      vi.useFakeTimers();
      vi.setSystemTime(nowSeconds * 1000);

      expect(() => resolveProrationDate(nowSeconds + 60)).toThrow(QuoteExpiredError);
    });
  });
});

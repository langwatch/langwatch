import { QuoteExpiredError } from "@langwatch/enterprise-billing-contract";
/**
 * A seat quote must reproduce the number the customer read, not merely
 * resemble it: money figures come off the invoice deterministically, apply
 * at the instant priced, and an expired quote is refused, never repriced.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QUOTE_VALIDITY_SECONDS,
  quotedAmounts,
  resolveProrationDate,
  seatChange,
} from "../seat-event-quote.rules.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("quotedAmounts", () => {
  describe("when the change costs the customer money", () => {
    it("reports the amount actually due and the credit that covered the rest", () => {
      expect(quotedAmounts({ total: 5000, amountDue: 3000 })).toEqual({
        prorationCents: 3000,
        creditAppliedCents: 2000,
      });
    });

    it("reports no credit applied on a clean account", () => {
      expect(quotedAmounts({ total: 5000, amountDue: 5000 })).toEqual({
        prorationCents: 5000,
        creditAppliedCents: 0,
      });
    });
  });

  describe("when the change credits the customer", () => {
    it("reports the signed total and draws no credit down", () => {
      expect(quotedAmounts({ total: -2500, amountDue: 0 })).toEqual({
        prorationCents: -2500,
        creditAppliedCents: 0,
      });
    });
  });
});

describe("seatChange", () => {
  const seatItem = { id: "si_1" };

  it("prices the change at the quoted instant and invoices it immediately", () => {
    expect(
      seatChange({
        subscription: { canceledAt: null },
        seatItem,
        quantity: 7,
        prorationDate: 1_700_000_000,
      }),
    ).toEqual({
      items: [{ id: "si_1", quantity: 7 }],
      prorationBehavior: "always_invoice",
      prorationDate: 1_700_000_000,
    });
  });

  describe("when the subscription was set to cancel", () => {
    it("also lifts the cancellation, so the seats bought are actually billed", () => {
      const change = seatChange({
        subscription: { canceledAt: 1_699_000_000 },
        seatItem,
        quantity: 2,
        prorationDate: 1_700_000_000,
      });

      expect(change.cancelAtPeriodEnd).toBe(false);
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

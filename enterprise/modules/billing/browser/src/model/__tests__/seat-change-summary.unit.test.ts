import { describe, expect, it } from "vitest";

import {
  billedSeatsWhileKept,
  seatChangeActionLabel,
  seatChangeSummary,
} from "../seat-change-summary.ts";

const quote = {
  amountDueCents: 0,
  formattedAmountDue: "€0",
  formattedCreditApplied: null,
  formattedRecurringTotal: "€1,044",
  billingInterval: "year",
  quotedAt: 1_700_000_000,
  appliesAt: Date.UTC(2027, 0, 1),
  keptSeats: 5,
  formattedKeptRecurringTotal: "€1,740",
};

describe("seatChangeActionLabel()", () => {
  it("names the count a decrease lowers to and the seats an increase adds", () => {
    expect(seatChangeActionLabel({ from: 5, to: 3 })).toBe("Lower to 3 seats");
    expect(seatChangeActionLabel({ from: 5, to: 6 })).toBe("Add 1 seat");
    expect(seatChangeActionLabel({ from: 5, to: 8 })).toBe("Add 3 seats");
  });
});

describe("seatChangeSummary()", () => {
  describe("when an annual plan is lowered", () => {
    it("says the seats stay for the rest of the year, priced per year", () => {
      const summary = seatChangeSummary({ from: 5, to: 3, quote });

      expect(summary.note).toBe(
        "You'll keep 5 seats until 1 Jan, then pay for 3. No refund for the rest of this year.",
      );
      expect(summary.rows).toEqual([
        { label: "Seats", value: "5 → 3" },
        { label: "From 1 Jan", value: "€1,044/yr" },
        { label: "Until 1 Jan", value: "€1,740/yr", muted: true },
      ]);
    });
  });

  describe("when the quote has not answered yet", () => {
    it("shows the seat change alone", () => {
      const summary = seatChangeSummary({ from: 5, to: 6, quote: undefined });

      expect(summary).toEqual({
        note: undefined,
        rows: [{ label: "Seats", value: "5 → 6" }],
        actionLabel: "Add 1 seat",
      });
    });
  });
});

describe("seatChangeSummary() for an added seat while lowered seats are kept", () => {
  it("says nothing is due today and when the new count is billed", () => {
    expect(seatChangeSummary({ from: 3, to: 4, quote }).note).toBe(
      "Nothing to pay today: you keep 5 seats until 1 Jan, then pay for 4.",
    );
  });
});

describe("billedSeatsWhileKept()", () => {
  const nowMs = Date.UTC(2026, 10, 6);
  const row = { maxMembers: 3, seatsKept: 5, seatsKeptUntil: "2026-12-01T00:00:00Z" };

  it("answers the billed seats while kept seats are in force", () => {
    expect(billedSeatsWhileKept({ subscription: row, nowMs })).toBe(3);
  });

  it("answers nothing once the kept seats ended", () => {
    expect(
      billedSeatsWhileKept({ subscription: row, nowMs: Date.UTC(2026, 11, 2) }),
    ).toBeUndefined();
  });

  it("answers nothing without kept seats or a subscription", () => {
    expect(
      billedSeatsWhileKept({
        subscription: { maxMembers: 3, seatsKept: null, seatsKeptUntil: null },
        nowMs,
      }),
    ).toBeUndefined();
    expect(billedSeatsWhileKept({ subscription: null, nowMs })).toBeUndefined();
  });
});

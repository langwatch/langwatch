import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  daysBetween,
  proratedSeatUnitAmountCents,
  seatInvoiceDescription,
} from "../connected-seat-proration.rules.ts";

const at = (iso: string) => Temporal.Instant.from(iso);

describe("what a mid-term seat change costs", () => {
  it("charges one seat for the days of the term that remain, rounded to the cent", () => {
    expect(
      proratedSeatUnitAmountCents({ seatRateCents: 60_000, daysRemaining: 182, termDays: 365 }),
    ).toBe(29_918);
  });

  it("multiplies the rounded unit back to the total the customer reads", () => {
    const unit = proratedSeatUnitAmountCents({
      seatRateCents: 60_000,
      daysRemaining: 182,
      termDays: 365,
    });

    expect(unit * 8).toBe(239_344);
  });

  it("charges nothing once the term has no days left", () => {
    expect(
      proratedSeatUnitAmountCents({ seatRateCents: 60_000, daysRemaining: 0, termDays: 365 }),
    ).toBe(0);
    expect(
      proratedSeatUnitAmountCents({ seatRateCents: 60_000, daysRemaining: -5, termDays: 365 }),
    ).toBe(0);
  });

  it("charges nothing for a term of no days rather than dividing by zero", () => {
    expect(
      proratedSeatUnitAmountCents({ seatRateCents: 60_000, daysRemaining: 10, termDays: 0 }),
    ).toBe(0);
  });

  it("counts whole days, and reads a day already past as negative", () => {
    expect(daysBetween(at("2026-01-01T00:00:00Z"), at("2026-01-11T12:00:00Z"))).toBe(10);
    expect(daysBetween(at("2026-01-11T00:00:00Z"), at("2026-01-01T00:00:00Z"))).toBe(-10);
  });

  it("names the day and the days charged on the invoice line", () => {
    expect(
      seatInvoiceDescription({
        addedSeats: 8,
        changedAt: at("2026-03-04T09:30:00Z"),
        daysRemaining: 182,
        termDays: 365,
      }),
    ).toBe("8 seats added on 2026-03-04, charged for the 182 days of the 365 day term that remain");
  });

  it("says seat, not seats, for one", () => {
    expect(
      seatInvoiceDescription({
        addedSeats: 1,
        changedAt: at("2026-03-04T09:30:00Z"),
        daysRemaining: 10,
        termDays: 365,
      }),
    ).toContain("1 seat added");
  });
});

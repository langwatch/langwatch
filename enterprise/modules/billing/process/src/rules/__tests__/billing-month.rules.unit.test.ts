import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  billingMonthDateRange,
  billingMonthOf,
  previousBillingMonthOf,
} from "../billing-month.rules.ts";

describe("billingMonthDateRange", () => {
  describe("when given a mid-year billing month", () => {
    /** @scenario "A month is asked for as a half-open range ending at the next month" */
    it("returns the first instant of the month and of the next month", () => {
      expect(billingMonthDateRange({ billingMonth: "2026-07" })).toEqual([
        "2026-07-01 00:00:00.000",
        "2026-08-01 00:00:00.000",
      ]);
    });
  });

  describe("when given December", () => {
    /** @scenario "A month is asked for as a half-open range ending at the next month" */
    it("rolls the end date over to January of the next year", () => {
      expect(billingMonthDateRange({ billingMonth: "2026-12" })).toEqual([
        "2026-12-01 00:00:00.000",
        "2027-01-01 00:00:00.000",
      ]);
    });
  });

  describe("when checking the range shape", () => {
    /** @scenario "A month is asked for as a half-open range ending at the next month" */
    it("produces a half-open range ending exactly at the next month boundary", () => {
      const [start, end] = billingMonthDateRange({ billingMonth: "2026-01" });
      expect(start).toBe("2026-01-01 00:00:00.000");
      // End is the *exclusive* boundary — the first millisecond of February,
      // to be used with `< endDate`, never `<=`.
      expect(end).toBe("2026-02-01 00:00:00.000");
    });
  });
});

describe("getBillingMonth", () => {
  describe("when the moment is the last instant of a month in UTC", () => {
    /** @scenario "The billing month is the UTC calendar month the moment falls in" */
    it("names that month rather than the next one a later time zone has entered", () => {
      expect(billingMonthOf({ now: Temporal.Instant.from("2026-01-31T23:59:59.999Z") })).toBe(
        "2026-01",
      );
    });
  });

  describe("when the moment is the first instant of a month in UTC", () => {
    /** @scenario "The billing month is the UTC calendar month the moment falls in" */
    it("names the month that has just begun, whatever the reader's own clock says", () => {
      expect(billingMonthOf({ now: Temporal.Instant.from("2026-02-01T00:00:00.000Z") })).toBe(
        "2026-02",
      );
    });
  });

  describe("when the moment is a leap day", () => {
    /** @scenario "The billing month is the UTC calendar month the moment falls in" */
    it("bills it under February", () => {
      expect(billingMonthOf({ now: Temporal.Instant.from("2028-02-29T12:00:00.000Z") })).toBe(
        "2028-02",
      );
    });
  });

  describe("when the month number is a single digit", () => {
    /** @scenario "The billing month is the UTC calendar month the moment falls in" */
    it("pads it so the string sorts and matches the stored one", () => {
      expect(billingMonthOf({ now: Temporal.Instant.from("2026-09-15T00:00:00.000Z") })).toBe(
        "2026-09",
      );
    });
  });
});

describe("getPreviousBillingMonth", () => {
  describe("when the moment is in January", () => {
    /** @scenario "The previous billing month walks back across a year end" */
    it("names December of the year before", () => {
      expect(
        previousBillingMonthOf({ now: Temporal.Instant.from("2026-01-03T04:00:00.000Z") }),
      ).toBe("2025-12");
    });
  });

  describe("when the moment is on the 31st and the month before is shorter", () => {
    /** @scenario "The previous billing month walks back across a year end" */
    it("names the month before rather than rolling forward past it", () => {
      expect(
        previousBillingMonthOf({ now: Temporal.Instant.from("2026-03-31T12:00:00.000Z") }),
      ).toBe("2026-02");
    });
  });

  describe("when the moment is the first instant of March in a leap year", () => {
    /** @scenario "The previous billing month walks back across a year end" */
    it("names February, the month the leap day belonged to", () => {
      expect(
        previousBillingMonthOf({ now: Temporal.Instant.from("2028-03-01T00:00:00.000Z") }),
      ).toBe("2028-02");
    });
  });

  describe("when the range for the previous month is taken", () => {
    /** @scenario "The previous billing month walks back across a year end" */
    it("closes at the first instant of the month the caller is in", () => {
      const previous = previousBillingMonthOf({
        now: Temporal.Instant.from("2026-01-15T00:00:00.000Z"),
      });

      expect(billingMonthDateRange({ billingMonth: previous })).toEqual([
        "2025-12-01 00:00:00.000",
        "2026-01-01 00:00:00.000",
      ]);
    });
  });
});

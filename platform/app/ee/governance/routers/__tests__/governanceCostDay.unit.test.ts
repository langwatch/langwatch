// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What counts as a day the cost read will accept.
 *
 * The shape check alone lets `2026-02-31` and `2026-99-99` through, and the
 * read binds the value as a ClickHouse `Date`, so an impossible day reaches
 * the driver and comes back as a parse failure — a generic "unknown error"
 * and a trace id for a rejection the boundary can name. The leap-year pair is
 * the case that earns the round trip rather than a month-length table.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */

import { describe, expect, it } from "vitest";

import { isUtcCalendarDay } from "../governanceCost";

describe("given a value that already matches YYYY-MM-DD", () => {
  describe("when it names a day the calendar has", () => {
    it("accepts it", () => {
      expect(isUtcCalendarDay("2026-01-01")).toBe(true);
      expect(isUtcCalendarDay("2026-02-28")).toBe(true);
      expect(isUtcCalendarDay("2026-12-31")).toBe(true);
    });
  });

  describe("when it names a day no calendar has", () => {
    it("rejects an impossible day of the month", () => {
      expect(isUtcCalendarDay("2026-02-31")).toBe(false);
      expect(isUtcCalendarDay("2026-04-31")).toBe(false);
    });

    it("rejects an impossible month", () => {
      expect(isUtcCalendarDay("2026-13-01")).toBe(false);
      expect(isUtcCalendarDay("2026-99-99")).toBe(false);
    });

    it("rejects a zero month or day", () => {
      expect(isUtcCalendarDay("2026-00-10")).toBe(false);
      expect(isUtcCalendarDay("2026-01-00")).toBe(false);
    });
  });

  describe("when it is the 29th of February", () => {
    it("accepts it in a leap year and refuses it in a common one", () => {
      expect(isUtcCalendarDay("2024-02-29")).toBe(true);
      expect(isUtcCalendarDay("2026-02-29")).toBe(false);
    });
  });
});

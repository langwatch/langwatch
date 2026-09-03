/**
 * @vitest-environment node
 * @unit
 *
 * The Opened column's date: short inside the current year, carrying the year
 * outside it.
 */
import { describe, expect, it } from "vitest";

import { formatShortDate } from "../short-date";

const NOW = new Date("2026-08-07T12:00:00Z").getTime();

describe("formatShortDate", () => {
  describe("given a date in the current year", () => {
    it("leaves the year out", () => {
      expect(
        formatShortDate({
          timestampMs: new Date("2026-08-03T09:30:00").getTime(),
          now: NOW,
        }),
      ).toBe("Aug 3");
    });
  });

  describe("given a date in another year", () => {
    it("carries the year", () => {
      expect(
        formatShortDate({
          timestampMs: new Date("2025-12-24T09:30:00").getTime(),
          now: NOW,
        }),
      ).toBe("Dec 24, 2025");
    });
  });

  describe("given a timestamp that is not a date", () => {
    it("formats nothing rather than crashing the row", () => {
      expect(formatShortDate({ timestampMs: Number.NaN, now: NOW })).toBe("");
    });
  });
});

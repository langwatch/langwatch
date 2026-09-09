import { describe, expect, it } from "vitest";

import { AnalyticsComparisonWindowService } from "../analytics-comparison-window.service.ts";

const service = AnalyticsComparisonWindowService.create();

/**
 * Midday UTC throughout: the window is counted on the reader's own calendar, so
 * a boundary near midnight would name a different day per runner time zone.
 */
const at = (value: string) => new Date(value);

describe("AnalyticsComparisonWindowService", () => {
  describe("when the window is a single day", () => {
    /** @scenario "The comparison window is the same length as the window it precedes" */
    it("puts the previous window on the day before", () => {
      const result = service.currentVsPrevious({
        startDate: at("2026-06-15T12:00:00Z"),
        endDate: at("2026-06-15T18:00:00Z"),
      });

      expect(result.daysDifference).toBe(1);
      expect(result.previousPeriodStartDate.getTime()).toBe(Date.parse("2026-06-14T12:00:00Z"));
    });
  });

  describe("when the window is a whole calendar month", () => {
    /** @scenario "The comparison window is the same length as the window it precedes" */
    it("counts the days the month actually has rather than a fixed thirty", () => {
      const result = service.currentVsPrevious({
        startDate: "2026-01-01T12:00:00Z",
        endDate: "2026-01-31T12:00:00Z",
      });

      expect(result.daysDifference).toBe(31);
      expect(result.previousPeriodStartDate.getTime()).toBe(Date.parse("2025-12-01T12:00:00Z"));
    });
  });

  describe("when the window ends on the far side of a year end", () => {
    /** @scenario "A comparison window walks back across a year end" */
    it("walks the previous window back into the year before", () => {
      const result = service.currentVsPrevious({
        startDate: "2027-01-05T12:00:00Z",
        endDate: "2027-01-14T12:00:00Z",
      });

      expect(result.daysDifference).toBe(10);
      expect(result.previousPeriodStartDate.getTime()).toBe(Date.parse("2026-12-26T12:00:00Z"));
    });
  });

  describe("when the window covers a leap day", () => {
    /** @scenario "The comparison window is the same length as the window it precedes" */
    it("counts the leap day as a day of the window", () => {
      const result = service.currentVsPrevious({
        startDate: "2028-02-27T12:00:00Z",
        endDate: "2028-03-01T12:00:00Z",
      });

      expect(result.daysDifference).toBe(4);
      expect(result.previousPeriodStartDate.getTime()).toBe(Date.parse("2028-02-23T12:00:00Z"));
    });
  });

  describe("when the caller passes epoch milliseconds rather than a Date", () => {
    /** @scenario "The comparison window is the same length as the window it precedes" */
    it("reads them as the same window a Date would give", () => {
      const startDate = Date.parse("2026-06-10T12:00:00Z");
      const endDate = Date.parse("2026-06-16T12:00:00Z");

      const fromNumbers = service.currentVsPrevious({ startDate, endDate });
      const fromDates = service.currentVsPrevious({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });

      expect(fromNumbers.daysDifference).toBe(fromDates.daysDifference);
      expect(fromNumbers.previousPeriodStartDate.getTime()).toBe(
        fromDates.previousPeriodStartDate.getTime(),
      );
    });
  });

  describe("when the datapoint step is shorter than a day", () => {
    /** @scenario "A comparison window is always a whole number of days" */
    it("still walks back a whole day rather than a fraction of one", () => {
      const result = service.currentVsPrevious(
        { startDate: "2026-06-15T12:00:00Z", endDate: "2026-06-15T18:00:00Z" },
        60,
      );

      expect(Number.isInteger(result.daysDifference)).toBe(true);
      expect(result.daysDifference).toBe(1);
      expect(result.previousPeriodStartDate.getTime()).toBe(Date.parse("2026-06-14T12:00:00Z"));
    });
  });

  describe("when the caller hands the window over end first", () => {
    /** @scenario "A comparison window is always a whole number of days" */
    it("answers with a whole day rather than failing on a fractional one", () => {
      const result = service.currentVsPrevious(
        { startDate: "2026-06-15T12:00:00Z", endDate: "2026-06-10T12:00:00Z" },
        60,
      );

      expect(Number.isInteger(result.daysDifference)).toBe(true);
      expect(result.previousPeriodStartDate.getTime()).toBeLessThan(
        Date.parse("2026-06-15T12:00:00Z"),
      );
    });
  });
});

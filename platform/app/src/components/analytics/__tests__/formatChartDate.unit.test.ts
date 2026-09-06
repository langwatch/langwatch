import { describe, expect, it } from "vitest";
import { formatChartDate } from "../formatChartDate";

describe("formatChartDate()", () => {
  describe("when date is falsy", () => {
    it("returns empty string for empty string", () => {
      expect(
        formatChartDate({ date: "", timeScale: 1440, daysDifference: 7 }),
      ).toBe("");
    });
  });

  describe("when date is an unparseable string", () => {
    it("returns empty string for 'current' (range bucket label)", () => {
      expect(
        formatChartDate({
          date: "current",
          timeScale: 1440,
          daysDifference: 7,
        }),
      ).toBe("");
    });

    it("returns empty string for 'previous' (range bucket label)", () => {
      expect(
        formatChartDate({
          date: "previous",
          timeScale: 1440,
          daysDifference: 7,
        }),
      ).toBe("");
    });

    it("returns empty string for arbitrary non-date text", () => {
      expect(
        formatChartDate({
          date: "not-a-date",
          timeScale: 1440,
          daysDifference: 7,
        }),
      ).toBe("");
    });
  });

  describe("when date is a valid ISO string", () => {
    const validDate = "2025-06-15T00:00:00.000Z";

    describe("when timeScale is daily or larger", () => {
      it("formats as 'MMM d'", () => {
        expect(
          formatChartDate({
            date: validDate,
            timeScale: 1440,
            daysDifference: 7,
          }),
        ).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
      });
    });

    describe("when timeScale is 'full'", () => {
      it("formats as 'MMM d'", () => {
        expect(
          formatChartDate({
            date: validDate,
            timeScale: "full",
            daysDifference: 7,
          }),
        ).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
      });
    });

    describe("when timeScale is sub-day (minutes)", () => {
      describe("when daysDifference is 1 or less", () => {
        it("formats as 'HH:mm'", () => {
          const result = formatChartDate({
            date: validDate,
            timeScale: 60,
            daysDifference: 1,
          });
          expect(result).toMatch(/^\d{2}:\d{2}$/);
        });
      });

      describe("when daysDifference is greater than 1", () => {
        it("formats as 'MMM d HH:mm'", () => {
          const result = formatChartDate({
            date: validDate,
            timeScale: 60,
            daysDifference: 3,
          });
          expect(result).toMatch(/^Jun 15 \d{2}:\d{2}$/);
        });
      });
    });
  });
});

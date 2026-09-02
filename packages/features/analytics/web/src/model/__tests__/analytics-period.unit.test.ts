/**
 * Which window the address means.
 *
 * The reading half of the period control, pure so the question "what range is
 * this chart drawn over" is answerable without a router. Every analytics read
 * keys on the two dates, so getting this wrong is not a cosmetic bug — it is
 * every chart on the page querying a window nobody asked for.
 */

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_RELATIVE_PRESETS,
  analyticsDaysDifference,
  computeRelativeWindow,
  presetForRange,
  readAnalyticsPeriod,
} from "../analytics-period";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("the analytics period", () => {
  describe("given an address that names neither a range nor a preset", () => {
    describe("when the window is read", () => {
      /** @scenario "An address naming no range falls back to the last thirty days" */
      it("falls back to the thirty-day window and says the reader did not pick it", () => {
        const reading = readAnalyticsPeriod({ query: {}, now: NOW });

        expect(reading.mode).toBe("relative");
        expect(reading.isDefault).toBe(true);
        expect(analyticsDaysDifference(reading.period.startDate, reading.period.endDate)).toBe(30);
      });
    });
  });

  describe("given an address that names a preset", () => {
    describe("when the window is read", () => {
      it("uses the preset and stops calling the window a default", () => {
        const reading = readAnalyticsPeriod({ query: { period: "7d" }, now: NOW });

        expect(reading.isDefault).toBe(false);
        expect(analyticsDaysDifference(reading.period.startDate, reading.period.endDate)).toBe(7);
      });

      it("ignores a preset key nothing offers rather than producing an empty window", () => {
        const reading = readAnalyticsPeriod({ query: { period: "42y" }, now: NOW });

        expect(reading.isDefault).toBe(true);
        expect(analyticsDaysDifference(reading.period.startDate, reading.period.endDate)).toBe(30);
      });
    });
  });

  describe("given an address that names an absolute range", () => {
    describe("when the window is read", () => {
      it("uses the two instants exactly", () => {
        const reading = readAnalyticsPeriod({
          query: {
            startDate: "2026-06-01T00:00:00.000Z",
            endDate: "2026-06-08T00:00:00.000Z",
          },
          now: NOW,
        });

        expect(reading.mode).toBe("absolute");
        expect(reading.period.startDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
        expect(reading.period.endDate.toISOString()).toBe("2026-06-08T00:00:00.000Z");
      });

      /**
       * A backwards range is a query for nothing at all: every chart would
       * report empty and nothing on screen would say why. Ordering the two
       * instants makes the worst case a one-instant window rather than a page
       * of silently empty charts.
       */
      it("orders a backwards range rather than querying a negative window", () => {
        const reading = readAnalyticsPeriod({
          query: {
            startDate: "2026-06-08T00:00:00.000Z",
            endDate: "2026-06-01T00:00:00.000Z",
          },
          now: NOW,
        });

        expect(reading.period.startDate.getTime()).toBeLessThanOrEqual(
          reading.period.endDate.getTime(),
        );
      });

      it("falls back to the relative default when an instant is unreadable", () => {
        const reading = readAnalyticsPeriod({
          query: { startDate: "not-a-date", endDate: "2026-06-08T00:00:00.000Z" },
          now: NOW,
        });

        expect(reading.mode).toBe("relative");
      });
    });
  });

  describe("given a sub-day preset", () => {
    describe("when its window is computed", () => {
      it("ends now and looks back exactly the minutes it names", () => {
        const window = computeRelativeWindow("15m", NOW);

        expect(window.endDate).toEqual(NOW);
        expect(NOW.getTime() - window.startDate.getTime()).toBe(15 * 60 * 1000);
      });
    });
  });

  describe("given a window that matches a day preset", () => {
    describe("when the trigger asks what to call it", () => {
      it("names the preset rather than printing two dates", () => {
        const window = computeRelativeWindow("7d", NOW);

        expect(presetForRange(window.startDate, window.endDate, NOW)?.key).toBe("7d");
      });

      it("names nothing for a window that ended days ago", () => {
        const window = computeRelativeWindow("7d", new Date("2026-05-01T12:00:00.000Z"));

        expect(presetForRange(window.startDate, window.endDate, NOW)).toBeUndefined();
      });
    });
  });

  describe("given the offered presets", () => {
    it("gives each of them a key of its own", () => {
      const keys = ANALYTICS_RELATIVE_PRESETS.map((preset) => preset.key);

      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});

/**
 * The two time chips' semantics, tested where they are decided rather than on
 * each of the five pages that render them.
 *
 * The interesting case is the one a fixed table cannot answer: year to date is
 * a year long in December and three weeks long in January, so whether a year
 * interval fits inside it depends on the day the page is read.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { describe, expect, it } from "vitest";

import {
  coerceInterval,
  DEFAULT_TIME_FRAME,
  DEFAULT_TIME_INTERVAL,
  isIntervalCoarserThanFrame,
  TIME_FRAMES,
  TIME_INTERVALS,
} from "../timeControls";

const JANUARY = new Date("2026-01-08T00:00:00Z");
const DECEMBER = new Date("2026-12-20T00:00:00Z");

describe("the governance time controls", () => {
  describe("given a page has not been told otherwise", () => {
    /** @scenario "Time Interval offers Month, Quarter and Year and opens on Quarter" */
    it("offers Month, Quarter and Year, opening on Quarter", () => {
      expect(TIME_INTERVALS.map((option) => option.label)).toEqual([
        "Month",
        "Quarter",
        "Year",
      ]);
      expect(DEFAULT_TIME_INTERVAL).toBe("quarter");
    });

    /** @scenario "Time Frame offers four spans and opens on Last 12 months" */
    it("offers four spans, opening on Last 12 months", () => {
      expect(TIME_FRAMES.map((option) => option.label)).toEqual([
        "Last 3 months",
        "Last 12 months",
        "Year to date",
        "Last 2 years",
      ]);
      expect(DEFAULT_TIME_FRAME).toBe("last_12_months");
    });
  });

  describe("when an interval is wider than the frame in view", () => {
    /** @scenario "An interval coarser than the frame is disabled" */
    it("reports the year interval as too coarse for a three-month frame", () => {
      expect(
        isIntervalCoarserThanFrame({
          interval: "year",
          frame: "last_3_months",
        }),
      ).toBe(true);
      expect(
        isIntervalCoarserThanFrame({
          interval: "month",
          frame: "last_3_months",
        }),
      ).toBe(false);
    });

    it("measures year to date by the day it is read on", () => {
      expect(
        isIntervalCoarserThanFrame({
          interval: "quarter",
          frame: "year_to_date",
          now: JANUARY,
        }),
      ).toBe(true);
      expect(
        isIntervalCoarserThanFrame({
          interval: "quarter",
          frame: "year_to_date",
          now: DECEMBER,
        }),
      ).toBe(false);
    });
  });

  describe("when the reader narrows the frame under a wide interval", () => {
    /** @scenario "Narrowing the frame steps the interval down to the widest that fits" */
    it("steps down to the widest interval that still fits", () => {
      expect(coerceInterval({ interval: "year", frame: "last_3_months" })).toBe(
        "month",
      );
      expect(
        coerceInterval({ interval: "quarter", frame: "last_12_months" }),
      ).toBe("quarter");
    });
  });
});

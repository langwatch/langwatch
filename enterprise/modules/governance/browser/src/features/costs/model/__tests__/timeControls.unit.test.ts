// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  coerceInterval,
  DEFAULT_TIME_FRAME,
  DEFAULT_TIME_INTERVAL,
  isIntervalCoarserThanFrame,
  TIME_FRAMES,
  TIME_INTERVALS,
} from "../time-controls.ts";

const NOW = Temporal.Instant.from("2026-09-25T12:00:00Z");

describe("the Time Interval chip", () => {
  /** @scenario "Time Interval offers Month, Quarter and Year and opens on Quarter" */
  it("offers Month, Quarter and Year and opens on Quarter", () => {
    expect(TIME_INTERVALS.map((option) => option.label)).toEqual(["Month", "Quarter", "Year"]);
    expect(DEFAULT_TIME_INTERVAL).toBe("quarter");
  });
});

describe("the Time Frame chip", () => {
  /** @scenario "Time Frame offers four spans and opens on Last 12 months" */
  it("offers four spans and opens on Last 12 months", () => {
    expect(TIME_FRAMES.map((option) => option.label)).toEqual([
      "Last 3 months",
      "Last 12 months",
      "Year to date",
      "Last 2 years",
    ]);
    expect(DEFAULT_TIME_FRAME).toBe("last_12_months");
  });
});

describe("given a Time Frame of Last 3 months", () => {
  /** @scenario "An interval coarser than the frame is disabled" */
  it("counts Year as too coarse and Month as available", () => {
    expect(isIntervalCoarserThanFrame({ interval: "year", frame: "last_3_months", now: NOW })).toBe(
      true,
    );
    expect(
      isIntervalCoarserThanFrame({ interval: "month", frame: "last_3_months", now: NOW }),
    ).toBe(false);
  });

  /** @scenario "Narrowing the frame steps the interval down to the widest that fits" */
  it("steps a Year interval down to the widest one that still fits", () => {
    expect(coerceInterval({ interval: "year", frame: "last_3_months", now: NOW })).toBe("month");
    expect(coerceInterval({ interval: "quarter", frame: "last_12_months", now: NOW })).toBe(
      "quarter",
    );
  });
});

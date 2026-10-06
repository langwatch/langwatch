/**
 * The grain a board asks for: day and week are real choices, and a grain too
 * fine for the range widens, up to a week. @see modules/dashboard/specs/dashboards-v1.feature
 */

import { describe, expect, it } from "vitest";

import {
  BOARD_PERIOD_RANGES,
  boardGrainFits,
  boardPeriodBounds,
  boardPeriodGranularity,
} from "../model/board-period.ts";

const NOW = Date.UTC(2026, 8, 28);
const DAY_S = 86_400;
const WEEK_S = 604_800;

describe("boardPeriodGranularity", () => {
  /** @scenario "AC13 Grain choices update every block" */
  it.each([
    ["1h", "24h", 3600],
    ["1d", "30d", DAY_S],
    ["1w", "90d", WEEK_S],
  ] as const)("asks for %s buckets over %s as %i seconds", (grain, range, seconds) => {
    const bounds = boardPeriodBounds({ range, now: NOW });
    expect(boardPeriodGranularity({ grain, ...bounds })).toBe(seconds);
  });

  it.each([
    ["24h", 3600],
    ["30d", DAY_S],
    ["90d", WEEK_S],
    ["1y", WEEK_S],
  ] as const)("reads auto over %s at %i-second buckets", (range, seconds) => {
    const bounds = boardPeriodBounds({ range, now: NOW });
    expect(boardPeriodGranularity({ grain: "auto", ...bounds })).toBe(seconds);
  });
});

describe("boardGrainFits", () => {
  /** @scenario "AC19b A grain that does not fit the range cannot be picked" */
  it.each(["live", "1h", "24h"] as const)("offers 1m over %s", (range) => {
    expect(boardGrainFits({ range, grain: "1m" })).toBe(true);
  });

  /** @scenario "AC19b A grain that does not fit the range cannot be picked" */
  it.each(["7d", "30d", "90d", "1y"] as const)("holds 1m back over %s", (range) => {
    expect(boardGrainFits({ range, grain: "1m" })).toBe(false);
  });

  /** @scenario "AC19b A grain that does not fit the range cannot be picked" */
  it.each(BOARD_PERIOD_RANGES)("never offers 5m, and always offers auto, over %s", (range) => {
    expect(boardGrainFits({ range, grain: "5m" })).toBe(false);
    expect(boardGrainFits({ range, grain: "auto" })).toBe(true);
  });
});

describe("given the Live range", () => {
  /** @scenario "AC19c Live is the last hour, rolling, refreshed every minute" */
  it("reads the last hour at one-minute buckets on auto", () => {
    const bounds = boardPeriodBounds({ range: "live", now: NOW });
    expect(bounds).toEqual({ periodStart: NOW - 3_600_000, periodEnd: NOW });
    expect(boardPeriodGranularity({ grain: "auto", ...bounds })).toBe(60);
  });
});

describe("fitGranularity", () => {
  it("widens to a week when days would exceed the bucket budget", () => {
    const thirtyYears = 30 * 365 * DAY_S * 1000;
    expect(boardPeriodGranularity({ grain: "1d", periodStart: 0, periodEnd: thirtyYears })).toBe(
      WEEK_S,
    );
  });
});

/**
 * The grain a board asks for: day and week are real choices, and a grain too
 * fine for the range widens, up to a week. @see modules/dashboard/specs/dashboards-v1.feature
 */

import { describe, expect, it } from "vitest";

import { boardPeriodBounds, boardPeriodGranularity } from "../model/board-period.ts";

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

describe("fitGranularity", () => {
  it("widens to a week when days would exceed the bucket budget", () => {
    const thirtyYears = 30 * 365 * DAY_S * 1000;
    expect(boardPeriodGranularity({ grain: "1d", periodStart: 0, periodEnd: thirtyYears })).toBe(
      WEEK_S,
    );
  });
});

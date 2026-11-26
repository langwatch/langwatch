/**
 * The grain a board asks for: day and week are real choices, and a grain too
 * fine for the range widens, up to a week. @see modules/dashboard/specs/dashboards-v1.feature
 */

import { describe, expect, it } from "vitest";

import {
  BOARD_PERIOD_PRESETS,
  boardGrainFits,
  boardPeriodBounds,
  boardPeriodGranularity,
  boardRangeSpanMs,
  boardRefreshApplies,
  boardWindowEnd,
  parseBoardRange,
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
    expect(boardGrainFits({ spanMs: boardRangeSpanMs({ range }), grain: "1m" })).toBe(true);
  });

  /** @scenario "AC19b A grain that does not fit the range cannot be picked" */
  it.each(["7d", "30d", "90d", "1y"] as const)("holds 1m back over %s", (range) => {
    expect(boardGrainFits({ spanMs: boardRangeSpanMs({ range }), grain: "1m" })).toBe(false);
  });

  /** @scenario "AC19b A grain that does not fit the range cannot be picked" */
  it.each(BOARD_PERIOD_PRESETS)("never offers 5m, and always offers auto, over %s", (range) => {
    expect(boardGrainFits({ spanMs: boardRangeSpanMs({ range }), grain: "5m" })).toBe(false);
    expect(boardGrainFits({ spanMs: boardRangeSpanMs({ range }), grain: "auto" })).toBe(true);
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

describe("boardWindowEnd", () => {
  const MINUTE = 60_000;

  describe("given a fixed range", () => {
    /** @scenario "AC19d A fixed range moves its end to now on each refresh" */
    it("ends at the minute the range was picked until the first refresh", () => {
      const end = boardWindowEnd({ range: "24h", now: NOW + 5 * MINUTE, pickedAt: NOW + 10 });
      expect(end).toBe(NOW + MINUTE);
    });

    /** @scenario "AC19d A fixed range moves its end to now on each refresh" */
    it("moves its end to the minute after each refresh", () => {
      const end = boardWindowEnd({
        range: "24h",
        now: NOW + 9 * MINUTE,
        pickedAt: NOW,
        refreshedAt: NOW + 3 * MINUTE + 1,
      });
      expect(end).toBe(NOW + 4 * MINUTE);
    });

    /** @scenario "AC19d A fixed range moves its end to now on each refresh" */
    it("keeps the range's length when the end moves", () => {
      const end = boardWindowEnd({
        range: "7d",
        now: NOW,
        pickedAt: NOW,
        refreshedAt: NOW + MINUTE,
      });
      const bounds = boardPeriodBounds({ range: "7d", now: end });
      expect(bounds.periodEnd - bounds.periodStart).toBe(7 * 86_400_000);
    });
  });

  describe("given the Live range", () => {
    /** @scenario "AC19c Live is the last hour, rolling, refreshed every minute" */
    it("rolls with the clock to the next minute", () => {
      const end = boardWindowEnd({ range: "live", now: NOW + 5 * MINUTE + 1, pickedAt: NOW });
      expect(end).toBe(NOW + 6 * MINUTE);
    });
  });
});

describe("given a custom range", () => {
  const FROM = Date.UTC(2026, 10, 4, 9);
  const TO = Date.UTC(2026, 10, 11, 9);
  const custom = { from: FROM, to: TO };
  const customSpan = boardRangeSpanMs({ range: "custom", custom });

  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("reads the address's from and to as the window", () => {
    const reading = parseBoardRange({
      range: "custom",
      from: "2026-11-04T09:00:00Z",
      to: "2026-11-11T09:00:00Z",
    });
    expect(reading).toEqual({ range: "custom", custom });
  });

  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("picks on auto the grain a preset of the same length gets", () => {
    const week = boardPeriodGranularity({ grain: "auto", periodStart: FROM, periodEnd: TO });
    const preset = boardPeriodBounds({ range: "7d", now: TO });
    expect(week).toBe(boardPeriodGranularity({ grain: "auto", ...preset }));
    expect(week).toBe(DAY_S);
    const sixHours = { periodStart: FROM, periodEnd: FROM + 6 * 3_600_000 };
    expect(boardPeriodGranularity({ grain: "auto", ...sixHours })).toBe(3600);
  });

  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("holds back a grain the window cannot carry", () => {
    expect(boardGrainFits({ spanMs: customSpan, grain: "1m" })).toBe(false);
    expect(boardGrainFits({ spanMs: customSpan, grain: "1h" })).toBe(true);
  });

  /** @scenario "AC19f Refresh does not apply to a custom range that has ended" */
  it("lets a refresh apply only while the window has not ended", () => {
    expect(boardRefreshApplies({ custom, now: TO + 1 })).toBe(false);
    expect(boardRefreshApplies({ custom, now: TO - 1 })).toBe(true);
    expect(boardRefreshApplies({ now: TO + 1 })).toBe(true);
  });

  /** @scenario "AC19g An address without a usable custom window reads the default range" */
  it.each([
    [{}],
    [{ from: "2026-11-04T09:00:00Z" }],
    [{ from: "yesterday", to: "2026-11-11T09:00:00Z" }],
    [{ from: "2026-11-11T09:00:00Z", to: "2026-11-04T09:00:00Z" }],
  ])("reads %o as the default 30 days", (window) => {
    expect(parseBoardRange({ range: "custom", ...window })).toEqual({ range: "30d" });
  });

  /** @scenario "AC19g An address without a usable custom window reads the default range" */
  it("keeps reading a preset address as before", () => {
    expect(parseBoardRange({ range: "7d", from: "2026-11-04T09:00:00Z" })).toEqual({
      range: "7d",
    });
    expect(parseBoardRange({ range: "nonsense" })).toEqual({ range: "30d" });
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

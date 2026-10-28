/**
 * The grain a board asks for: day and week are real choices, and a grain too
 * fine for the range widens, up to a week. @see modules/dashboard/specs/dashboards-v1.feature
 */

import { describe, expect, it } from "vitest";

import {
  BOARD_PERIOD_RANGES,
  boardExcludedOrigins,
  boardGrainFits,
  boardIncludesLangy,
  boardOriginsWithLangy,
  boardPeriodBounds,
  boardPeriodGranularity,
  boardWindowEnd,
  defaultBoardExcludedOrigins,
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

describe("fitGranularity", () => {
  it("widens to a week when days would exceed the bucket budget", () => {
    const thirtyYears = 30 * 365 * DAY_S * 1000;
    expect(boardPeriodGranularity({ grain: "1d", periodStart: 0, periodEnd: thirtyYears })).toBe(
      WEEK_S,
    );
  });
});

describe("defaultBoardExcludedOrigins", () => {
  describe("given a project that holds the member's agent", () => {
    /** @scenario "AC193 Langy: the origins a board leaves out are a list a board parameter can set later" */
    it("leaves out Langy's conversations", () => {
      expect(defaultBoardExcludedOrigins({ isPersonalProject: false })).toEqual(["langy"]);
    });
  });

  describe("given a personal project", () => {
    /** @scenario "AC198 Langy: a board in a personal project shows Langy's conversations" */
    it("leaves out no origin", () => {
      expect(defaultBoardExcludedOrigins({ isPersonalProject: true })).toEqual([]);
    });
  });
});

describe("boardExcludedOrigins", () => {
  describe("given a board that stores no origins", () => {
    /** @scenario "AC200f Langy setting: a widget that stores none follows its board's stored setting, else the default" */
    it("leaves out the project's default", () => {
      expect(boardExcludedOrigins({ stored: null, isPersonalProject: false })).toEqual(["langy"]);
    });

    /** @scenario "AC200f Langy setting: a widget that stores none follows its board's stored setting, else the default" */
    it("leaves out no origin in a personal project", () => {
      expect(boardExcludedOrigins({ stored: null, isPersonalProject: true })).toEqual([]);
    });
  });

  describe("given a board set to include Langy", () => {
    /** @scenario "AC200f Langy setting: a widget that stores none follows its board's stored setting, else the default" */
    it("leaves out what it stores, the empty list, wherever it is", () => {
      expect(boardExcludedOrigins({ stored: [], isPersonalProject: false })).toEqual([]);
      expect(boardIncludesLangy({ excluded: [] })).toBe(true);
    });
  });
});

describe("boardOriginsWithLangy", () => {
  /** @scenario "AC200b Langy setting: a widget saved as Included runs with no origin left out" */
  it("drops langy when the member includes it, and keeps other origins", () => {
    expect(boardOriginsWithLangy({ excluded: ["langy"], includeLangy: true })).toEqual([]);
    expect(boardOriginsWithLangy({ excluded: ["eval", "langy"], includeLangy: true })).toEqual([
      "eval",
    ]);
  });

  /** @scenario "AC200c Langy setting: picking Left out stores langy as the origin a widget leaves out" */
  it("adds langy when the member leaves it out", () => {
    expect(boardOriginsWithLangy({ excluded: [], includeLangy: false })).toEqual(["langy"]);
    expect(boardIncludesLangy({ excluded: ["langy"] })).toBe(false);
  });
});

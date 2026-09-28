/**
 * The grain a board asks for: day and week are real choices, and a grain too
 * fine for the range widens, up to a week. @see modules/dashboard/specs/dashboards-v1.feature
 */

import { LWQL_ACCEPTED_GRANULARITY_STEPS } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { fitGranularity } from "../blocks/index.ts";
import { TRACE_COUNT_SQL } from "../blocks/model/block-queries.ts";
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

  it("keeps auto at an hour over a year", () => {
    expect(
      boardPeriodGranularity({ grain: "auto", ...boardPeriodBounds({ range: "1y", now: NOW }) }),
    ).toBe(3600);
  });
});

describe("fitGranularity", () => {
  it("widens to a week when days would exceed the bucket budget", () => {
    const thirtyYears = 30 * 365 * DAY_S * 1000;
    expect(fitGranularity({ periodStart: 0, periodEnd: thirtyYears, requested: DAY_S })).toBe(
      WEEK_S,
    );
  });
});

describe("the block bucket", () => {
  it("anchors week buckets on Mondays without moving any finer step", () => {
    const offset = 345_600;
    expect(new Date(offset * 1000).getUTCDay()).toBe(1);
    for (const step of LWQL_ACCEPTED_GRANULARITY_STEPS.filter((each) => each < WEEK_S)) {
      expect(offset % step).toBe(0);
    }
    expect(TRACE_COUNT_SQL).toContain(`subtractSeconds(OccurredAt, ${offset})`);
  });
});

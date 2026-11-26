/**
 * The Free scenario run cap: the grace after the first run, the UTC month and the heads-up.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import { describe, expect, it } from "vitest";

import {
  DAY_MS,
  decideGraceNotice,
  isInGrace,
  isRunRefused,
  isThresholdReached,
  scenarioRunMonthOf,
} from "../scenario-run-cap.rules.ts";

const cap = { capped: true as const, maxPerMonth: 100, graceDays: 14 };
const now = Date.UTC(2026, 10, 20, 12);

describe("isRunRefused", () => {
  /** @scenario Cloud Free allows any number of runs during the grace */
  it("allows any count while the grace runs", () => {
    expect(isRunRefused({ runs: 5000, firstRunAt: now - 3 * DAY_MS, cap, now })).toBe(false);
  });

  it("allows runs before any first run is metered", () => {
    expect(isRunRefused({ runs: 500, firstRunAt: null, cap, now })).toBe(false);
  });

  /** @scenario Cloud Free refuses the 101st run of the month after the grace */
  it("refuses the 101st run once the grace ended", () => {
    expect(isRunRefused({ runs: 100, firstRunAt: now - 30 * DAY_MS, cap, now })).toBe(true);
  });

  /** @scenario Cloud Free allows runs below the monthly cap after the grace */
  it("allows the 100th run after the grace", () => {
    expect(isRunRefused({ runs: 99, firstRunAt: now - 30 * DAY_MS, cap, now })).toBe(false);
  });
});

describe("isInGrace", () => {
  it("ends exactly 14 days after the first run", () => {
    const firstRunAt = now - 14 * DAY_MS;
    expect(isInGrace({ firstRunAt, cap, now: now - 1 })).toBe(true);
    expect(isInGrace({ firstRunAt, cap, now })).toBe(false);
  });
});

describe("scenarioRunMonthOf", () => {
  /** @scenario The monthly run count starts again each UTC calendar month */
  it("keys the count by UTC calendar month, the window ending at the next month", () => {
    expect(scenarioRunMonthOf(Date.UTC(2026, 10, 30, 23, 59, 59))).toEqual({
      month: "2026-11",
      startDate: "2026-11-01 00:00:00.000",
      endDate: "2026-12-01 00:00:00.000",
    });
    expect(scenarioRunMonthOf(Date.UTC(2026, 11, 1)).month).toBe("2026-12");
    expect(scenarioRunMonthOf(Date.UTC(2026, 11, 31, 23)).endDate).toBe("2027-01-01 00:00:00.000");
  });
});

describe("isThresholdReached", () => {
  it("is reached at 80 of 100 runs, not at 79", () => {
    expect(isThresholdReached({ runs: 79, cap })).toBe(false);
    expect(isThresholdReached({ runs: 80, cap })).toBe(true);
  });
});

describe("decideGraceNotice", () => {
  const firstRunAt = now - 15 * DAY_MS;

  it("is running before the end", () => {
    expect(decideGraceNotice({ firstRunAt, cap, now: firstRunAt + DAY_MS }).kind).toBe("running");
  });

  it("ended when looked at within two days of the end", () => {
    expect(decideGraceNotice({ firstRunAt, cap, now })).toEqual({
      kind: "ended",
      graceEndsAt: firstRunAt + 14 * DAY_MS,
    });
  });

  it("closes silently when the end is long past", () => {
    expect(decideGraceNotice({ firstRunAt: now - 90 * DAY_MS, cap, now }).kind).toBe(
      "closedSilently",
    );
  });
});

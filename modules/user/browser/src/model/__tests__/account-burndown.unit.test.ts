/**
 * @see specs/coding-agent/account-burndown.feature
 */
import { describe, expect, it } from "vitest";

import {
  cumulativeTokens,
  formatLimitMoment,
  formatUsagePercent,
} from "../coding-agent/account-burndown.ts";

const day = (tokens: number) => ({
  day: "2026-11-26",
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
});

describe("account burndown formatting", () => {
  it("adds each day's tokens to the ones before it", () => {
    expect(cumulativeTokens([day(10), day(0), day(5)])).toEqual([10, 10, 15]);
  });

  it("rounds the reported percent", () => {
    expect(formatUsagePercent(71.6)).toBe("72%");
  });

  describe("given a limit that ends later today", () => {
    it("shows only the time", () => {
      const nowMs = new Date(2026, 10, 26, 9, 0).getTime();
      const untilMs = new Date(2026, 10, 26, 16, 45).getTime();

      expect(formatLimitMoment(untilMs, nowMs)).toBe("16:45");
    });
  });

  describe("given a limit that ends on another day", () => {
    it("shows the day too", () => {
      const nowMs = new Date(2026, 10, 26, 9, 0).getTime();
      const untilMs = new Date(2026, 10, 27, 8, 0).getTime();

      expect(formatLimitMoment(untilMs, nowMs)).toBe("Fri 27 Nov, 08:00");
    });
  });
});

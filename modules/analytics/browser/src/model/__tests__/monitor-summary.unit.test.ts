import { describe, expect, it } from "vitest";

import { monitorPeriodLabel, summarizeMonitor } from "../monitor-summary.ts";

const KEY = "0/evaluation_score/avg";
const PASS = "0/evaluation_pass_rate/avg";
const rows = (key: string, values: number[]) => values.map((value) => ({ [key]: value }));

describe("summarizeMonitor", () => {
  it("heads the card with the full-period value, not the daily average", () => {
    const summary = summarizeMonitor({
      seriesKey: KEY,
      data: rows(KEY, [0.2, 0.4]),
      filledData: rows(KEY, [0.2, 0.4]),
      summary: {
        data: { currentPeriod: [{ date: "full", [KEY]: 0.9 }], previousPeriod: [] },
        isError: false,
      },
      disabled: false,
    });
    expect(summary).toEqual({
      isPassRate: false,
      summaryValue: 0.9,
      hasData: true,
      hasLoaded: true,
      colorSet: "greenTones",
      scoreLabel: "Average Score",
      maxValue: 0.4,
    });
  });

  it("falls back to the daily average only when the full-period read failed", () => {
    const failed = summarizeMonitor({
      seriesKey: PASS,
      data: rows(PASS, [0.2, 0.4]),
      filledData: rows(PASS, [0.2, 1, 0.4]),
      summary: { data: undefined, isError: true },
      disabled: false,
    });
    expect(failed).toMatchObject({ summaryValue: 0.30000000000000004, colorSet: "redTones" });
    expect(failed).toMatchObject({ isPassRate: true, scoreLabel: "Pass Rate", maxValue: 1 });
  });

  it("is orange between the thresholds, and grey when the monitor is disabled", () => {
    const at = (disabled: boolean) =>
      summarizeMonitor({
        seriesKey: KEY,
        data: [],
        filledData: [],
        summary: {
          data: { currentPeriod: [{ date: "full", [KEY]: 0.6 }], previousPeriod: [] },
          isError: false,
        },
        disabled,
      }).colorSet;
    expect(at(false)).toBe("orangeTones");
    expect(at(true)).toBe("grayTones");
  });

  it("has not loaded while the sparkline or the summary is missing", () => {
    const summary = summarizeMonitor({
      seriesKey: KEY,
      data: undefined,
      filledData: undefined,
      summary: { data: undefined, isError: false },
      disabled: false,
    });
    expect(summary).toMatchObject({ hasLoaded: false, hasData: false, colorSet: "greenTones" });
  });
});

describe("monitorPeriodLabel", () => {
  const now = Date.UTC(2026, 8, 25, 12);
  const day = 86_400_000;

  it("says the last N days when the period ends about now, else the date range", () => {
    expect(monitorPeriodLabel({ startDate: now - 7 * day, endDate: now, now })).toBe("Last 7 days");
    expect(monitorPeriodLabel({ startDate: now - 40 * day, endDate: now - 10 * day, now })).toMatch(
      /^Aug 16 - Sep 15, 2026$/,
    );
  });
});

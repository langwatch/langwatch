/**
 * Calendar windows roll at midnight in the budget's own timezone.
 * @see specs/ai-gateway/budgets.feature
 */
import {
  computeBudgetPeriodFloorMs,
  effectiveBudgetPeriod,
  GatewayWindow,
  resolveBudgetTimeZone,
  type GatewayBudgetWindow,
} from "@langwatch/gateway-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

const at = (iso: string): Instant => Temporal.Instant.from(iso);
const iso = (instant: Instant): string => instant.toString({ fractionalSecondDigits: 3 });

function calendarBudget({
  window,
  timezone,
  lastResetAt = null,
}: {
  window: GatewayBudgetWindow;
  timezone: string | null;
  lastResetAt?: Instant | null;
}) {
  return {
    window,
    timezone,
    currentPeriodStartedAt: lastResetAt ?? at("2026-01-01T00:00:00Z"),
    resetsAt: at("2026-01-02T00:00:00Z"),
    lastResetAt,
    cycleAnchorAt: null,
  };
}

function period(input: { window: GatewayBudgetWindow; timezone: string | null; now: string }) {
  const { currentPeriodStartedAt, resetsAt } = effectiveBudgetPeriod(
    calendarBudget({ window: input.window, timezone: input.timezone }),
    at(input.now),
  );
  return { start: iso(currentPeriodStartedAt), end: iso(resetsAt) };
}

describe("budget windows in the budget's timezone", () => {
  /** @scenario "Day, week and month windows roll at midnight in the budget's timezone" */
  it("rolls day, week and month windows at Amsterdam midnight", () => {
    const now = "2026-07-15T21:30:00Z";
    expect(period({ window: "DAY", timezone: "Europe/Amsterdam", now })).toEqual({
      start: "2026-07-14T22:00:00.000Z",
      end: "2026-07-15T22:00:00.000Z",
    });
    expect(period({ window: "WEEK", timezone: "Europe/Amsterdam", now })).toEqual({
      start: "2026-07-12T22:00:00.000Z",
      end: "2026-07-19T22:00:00.000Z",
    });
    expect(period({ window: "MONTH", timezone: "Europe/Amsterdam", now })).toEqual({
      start: "2026-06-30T22:00:00.000Z",
      end: "2026-07-31T22:00:00.000Z",
    });
    expect(iso(GatewayWindow.nextResetAt("DAY", at(now), "Europe/Amsterdam"))).toBe(
      "2026-07-15T22:00:00.000Z",
    );
  });

  /** @scenario "A local-midnight boundary stays at midnight across a daylight saving change" */
  it("keeps New York day boundaries at local midnight across both clock changes", () => {
    const springForward = period({
      window: "DAY",
      timezone: "America/New_York",
      now: "2026-03-08T12:00:00Z",
    });
    expect(springForward).toEqual({
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T04:00:00.000Z",
    });
    const fallBack = period({
      window: "DAY",
      timezone: "America/New_York",
      now: "2026-11-01T12:00:00Z",
    });
    expect(fallBack).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
    });
    const hours = (p: { start: string; end: string }) =>
      (at(p.end).epochMilliseconds - at(p.start).epochMilliseconds) / 3_600_000;
    expect(hours(springForward)).toBe(23);
    expect(hours(fallBack)).toBe(25);
  });

  it("starts and ends week and month periods spanning a clock change at local midnight", () => {
    expect(
      period({ window: "WEEK", timezone: "America/New_York", now: "2026-03-08T12:00:00Z" }),
    ).toEqual({ start: "2026-03-02T05:00:00.000Z", end: "2026-03-09T04:00:00.000Z" });
    expect(
      period({ window: "MONTH", timezone: "America/New_York", now: "2026-03-20T12:00:00Z" }),
    ).toEqual({ start: "2026-03-01T05:00:00.000Z", end: "2026-04-01T04:00:00.000Z" });
    expect(
      period({ window: "MONTH", timezone: "Europe/Amsterdam", now: "2026-10-31T23:30:00Z" }),
    ).toEqual({ start: "2026-10-31T23:00:00.000Z", end: "2026-11-30T23:00:00.000Z" });
  });

  /** @scenario "A budget with no usable timezone rolls on UTC" */
  it("falls back to UTC for an empty, missing or unknown zone and keeps the rollup path", () => {
    const now = at("2026-07-15T21:30:00Z");
    for (const timezone of [null, "", "  ", "Not/AZone", "UTC"]) {
      expect(resolveBudgetTimeZone(timezone)).toBe("UTC");
      expect(period({ window: "DAY", timezone, now: "2026-07-15T21:30:00Z" })).toEqual({
        start: "2026-07-15T00:00:00.000Z",
        end: "2026-07-16T00:00:00.000Z",
      });
      expect(
        computeBudgetPeriodFloorMs(calendarBudget({ window: "MONTH", timezone }), now),
      ).toBeUndefined();
    }
  });

  it("keeps the rollup path for a zone whose midnight is the UTC one", () => {
    expect(
      computeBudgetPeriodFloorMs(
        calendarBudget({ window: "DAY", timezone: "Europe/London" }),
        at("2026-01-15T12:00:00Z"),
      ),
    ).toBeUndefined();
  });

  /** @scenario "Spend for a non-UTC budget is read from its local period start" */
  it("floors the spend read at Tokyo midnight, and at a reset inside that day", () => {
    const now = at("2026-07-15T10:00:00Z");
    expect(
      computeBudgetPeriodFloorMs(calendarBudget({ window: "DAY", timezone: "Asia/Tokyo" }), now),
    ).toBe(at("2026-07-14T15:00:00Z").epochMilliseconds);

    const reset = at("2026-07-15T03:00:00Z");
    const resetBudget = calendarBudget({
      window: "DAY",
      timezone: "Asia/Tokyo",
      lastResetAt: reset,
    });
    expect(computeBudgetPeriodFloorMs(resetBudget, now)).toBe(reset.epochMilliseconds);
    expect(computeBudgetPeriodFloorMs(resetBudget, at("2026-07-15T16:00:00Z"))).toBe(
      at("2026-07-15T15:00:00Z").epochMilliseconds,
    );
  });

  it("leaves anchored cycles on their anchor whatever the zone says", () => {
    const anchor = at("2026-06-17T09:00:00Z");
    expect(
      iso(
        GatewayWindow.nextBoundaryFor({
          budget: { window: "MONTH", cycleAnchorAt: anchor, timezone: "Asia/Tokyo" },
          now: at("2026-07-15T00:00:00Z"),
        }),
      ),
    ).toBe("2026-07-17T09:00:00.000Z");
  });
});

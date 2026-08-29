/**
 * @see specs/ai-gateway/budgets.feature
 *
 * Anchored budget cycles: a budget created with a `cycleAnchorAt` rolls from
 * that instant instead of from the calendar. The arithmetic is all UTC epoch
 * milliseconds and UTC calendar fields, so no local clock change can reach it.
 *
 * Pure cycle math only. What a stored budget row makes of it, floors and
 * reported periods, is in gateway-budget-period-floor.unit.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  anchoredPeriodStart,
  CYCLIC_WINDOWS,
  isCyclicWindow,
  nextAnchoredResetAt,
  nextBoundaryFor,
} from "../index";

const iso = (d: Date) => d.toISOString();

/** The first `count` period starts, followed boundary by boundary. */
function walkPeriods({
  window,
  anchor,
  count,
}: {
  window: (typeof CYCLIC_WINDOWS)[number];
  anchor: Date;
  count: number;
}): string[] {
  const starts: string[] = [];
  let cursor = anchor;
  for (let i = 0; i < count; i++) {
    starts.push(iso(cursor));
    cursor = nextAnchoredResetAt({ window, anchorAt: anchor, now: cursor });
  }
  return starts;
}

/** Each of those instants, floored back to the period it opens. */
function refloorPeriods({
  window,
  anchor,
  starts,
}: {
  window: (typeof CYCLIC_WINDOWS)[number];
  anchor: Date;
  starts: string[];
}): string[] {
  return starts.map((s) =>
    iso(anchoredPeriodStart({ window, anchorAt: anchor, now: new Date(s) })),
  );
}

describe("anchored cycle math", () => {
  it("names exactly the windows that roll on their own", () => {
    expect([...CYCLIC_WINDOWS]).toEqual(["MINUTE", "HOUR", "DAY", "WEEK", "MONTH"]);
    expect(isCyclicWindow("TOTAL")).toBe(false);
    expect(isCyclicWindow("MANUAL")).toBe(false);
    expect(isCyclicWindow("MONTH")).toBe(true);
  });

  /** @scenario "An anchored cycle starts periods at the anchor instant, not the calendar" */
  it("phases a month off the anchor day and time rather than the 1st", () => {
    const anchor = new Date("2026-06-17T09:00:00.000Z");

    // Mid-period: July 15th still belongs to the period that opened on the
    // 17th of June, and the next boundary is the 17th of July.
    const now = new Date("2026-07-15T00:00:00.000Z");
    expect(iso(anchoredPeriodStart({ window: "MONTH", anchorAt: anchor, now }))).toBe(
      "2026-06-17T09:00:00.000Z",
    );
    expect(iso(nextAnchoredResetAt({ window: "MONTH", anchorAt: anchor, now }))).toBe(
      "2026-07-17T09:00:00.000Z",
    );

    // The boundary opens the new period: one millisecond before it the old
    // period still holds, at it exactly the new one does.
    expect(
      iso(
        anchoredPeriodStart({
          window: "MONTH",
          anchorAt: anchor,
          now: new Date("2026-07-17T08:59:59.999Z"),
        }),
      ),
    ).toBe("2026-06-17T09:00:00.000Z");
    expect(
      iso(
        anchoredPeriodStart({
          window: "MONTH",
          anchorAt: anchor,
          now: new Date("2026-07-17T09:00:00.000Z"),
        }),
      ),
    ).toBe("2026-07-17T09:00:00.000Z");
  });

  it("hands every boundary to the period it opens, with no gap or overlap", () => {
    // A gap would drop the spend that landed in it; an overlap would count
    // it against two periods. Each boundary must floor back onto itself.
    for (const anchor of [
      new Date("2026-01-31T10:00:00.000Z"),
      new Date("2026-06-17T09:00:00.000Z"),
    ]) {
      for (const window of CYCLIC_WINDOWS) {
        const starts = walkPeriods({ window, anchor, count: 14 });
        expect(refloorPeriods({ window, anchor, starts })).toEqual(starts);
      }
    }
  });

  /** @scenario "A month cycle anchored past the 28th clamps into shorter months and springs back" */
  it("clamps from the original anchor day every period, never from the clamped one", () => {
    // The 31st: February clamps, March springs back to the 31st. Reading the
    // day off the previous period instead would walk the cycle back to the
    // 28th and leave it there, quietly moving the customer's billing day.
    expect(
      walkPeriods({
        window: "MONTH",
        anchor: new Date("2026-01-31T10:00:00.000Z"),
        count: 7,
      }),
    ).toEqual([
      "2026-01-31T10:00:00.000Z",
      "2026-02-28T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z",
      "2026-04-30T10:00:00.000Z",
      "2026-05-31T10:00:00.000Z",
      "2026-06-30T10:00:00.000Z",
      "2026-07-31T10:00:00.000Z",
    ]);

    // A leap February takes the 29th.
    expect(
      walkPeriods({
        window: "MONTH",
        anchor: new Date("2028-01-31T00:00:00.000Z"),
        count: 3,
      }),
    ).toEqual([
      "2028-01-31T00:00:00.000Z",
      "2028-02-29T00:00:00.000Z",
      "2028-03-31T00:00:00.000Z",
    ]);

    // The 30th clamps to the 28th in a common February and returns to the
    // 30th, and the 29th clamps only in a common year.
    expect(
      walkPeriods({
        window: "MONTH",
        anchor: new Date("2026-01-30T00:00:00.000Z"),
        count: 3,
      }),
    ).toEqual([
      "2026-01-30T00:00:00.000Z",
      "2026-02-28T00:00:00.000Z",
      "2026-03-30T00:00:00.000Z",
    ]);
    expect(
      walkPeriods({
        window: "MONTH",
        anchor: new Date("2028-01-29T00:00:00.000Z"),
        count: 3,
      }),
    ).toEqual([
      "2028-01-29T00:00:00.000Z",
      "2028-02-29T00:00:00.000Z",
      "2028-03-29T00:00:00.000Z",
    ]);

    // A 31st anchor mid-year: only the 30-day months clamp.
    expect(
      walkPeriods({
        window: "MONTH",
        anchor: new Date("2026-05-31T00:00:00.000Z"),
        count: 5,
      }),
    ).toEqual([
      "2026-05-31T00:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
      "2026-07-31T00:00:00.000Z",
      "2026-08-31T00:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
    ]);
  });

  it("steps fixed-length windows by exact modulo off the anchor", () => {
    const cases = [
      { window: "MINUTE" as const, lengthMs: 60_000 },
      { window: "HOUR" as const, lengthMs: 3_600_000 },
      { window: "DAY" as const, lengthMs: 86_400_000 },
      { window: "WEEK" as const, lengthMs: 604_800_000 },
    ];
    const anchor = new Date("2026-03-07T13:42:17.500Z");
    for (const { window, lengthMs } of cases) {
      for (const k of [0, 1, 5, 97]) {
        const inside = new Date(anchor.getTime() + k * lengthMs + 17);
        expect(
          anchoredPeriodStart({
            window,
            anchorAt: anchor,
            now: inside,
          }).getTime(),
        ).toBe(anchor.getTime() + k * lengthMs);
        expect(
          nextAnchoredResetAt({
            window,
            anchorAt: anchor,
            now: inside,
          }).getTime(),
        ).toBe(anchor.getTime() + (k + 1) * lengthMs);
      }
    }

    // A week anchored on a Saturday rolls on Saturdays. The ISO Monday the
    // calendar window uses plays no part once a budget is anchored.
    const saturday = new Date("2026-03-07T13:42:17.500Z");
    expect(saturday.getUTCDay()).toBe(6);
    const nextWeek = nextAnchoredResetAt({
      window: "WEEK",
      anchorAt: saturday,
      now: saturday,
    });
    expect(nextWeek.getUTCDay()).toBe(6);
    expect(iso(nextWeek)).toBe("2026-03-14T13:42:17.500Z");
  });

  it("keeps a DAY cycle exactly 86400s apart across US and EU clock changes", () => {
    // US DST starts 2026-03-08, EU 2026-03-29. Neither exists in UTC, and
    // this is the assertion that keeps it that way.
    const anchor = new Date("2026-03-08T02:30:00.000Z");
    for (let k = 0; k <= 30; k++) {
      const inside = new Date(anchor.getTime() + k * 86_400_000 + 3_600_000);
      const start = anchoredPeriodStart({
        window: "DAY",
        anchorAt: anchor,
        now: inside,
      });
      expect(start.getTime()).toBe(anchor.getTime() + k * 86_400_000);
      expect(start.getUTCHours()).toBe(2);
      expect(start.getUTCMinutes()).toBe(30);
    }
  });

  it("reports the anchor itself before the first period opens", () => {
    // A budget anchored to next month exists but has not started. Flooring a
    // read at the anchor totals nothing, which is what makes a future anchor
    // work with no special case anywhere downstream.
    const anchor = new Date("2026-09-01T00:00:00.000Z");
    const now = new Date("2026-08-04T12:00:00.000Z");
    for (const window of CYCLIC_WINDOWS) {
      expect(iso(anchoredPeriodStart({ window, anchorAt: anchor, now }))).toBe(
        iso(anchor),
      );
      expect(iso(nextAnchoredResetAt({ window, anchorAt: anchor, now }))).toBe(
        iso(anchor),
      );
    }
  });

  it("routes non-cycling windows to the sentinel whatever the anchor says", () => {
    const anchor = new Date("2026-06-17T09:00:00.000Z");
    const now = new Date("2026-07-15T00:00:00.000Z");
    for (const window of ["TOTAL", "MANUAL"] as const) {
      expect(
        nextBoundaryFor({
          budget: { window, cycleAnchorAt: anchor },
          now,
        }).getUTCFullYear(),
      ).toBe(9999);
    }
    // Unanchored cyclic windows keep the calendar boundary.
    expect(
      iso(
        nextBoundaryFor({
          budget: { window: "MONTH", cycleAnchorAt: null },
          now,
        }),
      ),
    ).toBe("2026-08-01T00:00:00.000Z");
    expect(
      iso(
        nextBoundaryFor({
          budget: { window: "MONTH", cycleAnchorAt: anchor },
          now,
        }),
      ),
    ).toBe("2026-07-17T09:00:00.000Z");
  });
});

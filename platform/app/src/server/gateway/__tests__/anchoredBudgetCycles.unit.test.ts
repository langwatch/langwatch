/**
 * @see specs/ai-gateway/budgets.feature
 *
 * Anchored budget cycles: a budget created with a `cycleAnchorAt` rolls from
 * that instant instead of from the calendar. The arithmetic is all UTC epoch
 * milliseconds and UTC calendar fields, so no local clock change can reach it.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  budgetPeriodFloorMs,
  effectiveBudgetPeriod,
} from "../budget.clickhouse.repository";
import { GatewayBudgetService } from "../budget.service";
import {
  anchoredPeriodStart,
  CYCLIC_WINDOWS,
  isCyclicWindow,
  nextAnchoredResetAt,
  nextBoundaryFor,
} from "../budgetWindow";

const iso = (d: Date) => d.toISOString();

/** The first `count` period starts, followed boundary by boundary. */
function walkPeriods(
  window: (typeof CYCLIC_WINDOWS)[number],
  anchor: Date,
  count: number,
): string[] {
  const starts: string[] = [];
  let cursor = anchor;
  for (let i = 0; i < count; i++) {
    starts.push(iso(cursor));
    cursor = nextAnchoredResetAt(window, anchor, cursor);
  }
  return starts;
}

/** Each of those instants, floored back to the period it opens. */
function refloorPeriods(
  window: (typeof CYCLIC_WINDOWS)[number],
  anchor: Date,
  starts: string[],
): string[] {
  return starts.map((s) =>
    iso(anchoredPeriodStart(window, anchor, new Date(s))),
  );
}

describe("anchored cycle math", () => {
  it("names exactly the windows that roll on their own", () => {
    expect([...CYCLIC_WINDOWS]).toEqual([
      "MINUTE",
      "HOUR",
      "DAY",
      "WEEK",
      "MONTH",
    ]);
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
    expect(iso(anchoredPeriodStart("MONTH", anchor, now))).toBe(
      "2026-06-17T09:00:00.000Z",
    );
    expect(iso(nextAnchoredResetAt("MONTH", anchor, now))).toBe(
      "2026-07-17T09:00:00.000Z",
    );

    // The boundary opens the new period: one millisecond before it the old
    // period still holds, at it exactly the new one does.
    expect(
      iso(
        anchoredPeriodStart(
          "MONTH",
          anchor,
          new Date("2026-07-17T08:59:59.999Z"),
        ),
      ),
    ).toBe("2026-06-17T09:00:00.000Z");
    expect(
      iso(
        anchoredPeriodStart(
          "MONTH",
          anchor,
          new Date("2026-07-17T09:00:00.000Z"),
        ),
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
        const starts = walkPeriods(window, anchor, 14);
        expect(refloorPeriods(window, anchor, starts)).toEqual(starts);
      }
    }
  });

  /** @scenario "A month cycle anchored past the 28th clamps into shorter months and springs back" */
  it("clamps from the original anchor day every period, never from the clamped one", () => {
    // The 31st: February clamps, March springs back to the 31st. Reading the
    // day off the previous period instead would walk the cycle back to the
    // 28th and leave it there, quietly moving the customer's billing day.
    expect(
      walkPeriods("MONTH", new Date("2026-01-31T10:00:00.000Z"), 7),
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
      walkPeriods("MONTH", new Date("2028-01-31T00:00:00.000Z"), 3),
    ).toEqual([
      "2028-01-31T00:00:00.000Z",
      "2028-02-29T00:00:00.000Z",
      "2028-03-31T00:00:00.000Z",
    ]);

    // The 30th clamps to the 28th in a common February and returns to the
    // 30th, and the 29th clamps only in a common year.
    expect(
      walkPeriods("MONTH", new Date("2026-01-30T00:00:00.000Z"), 3),
    ).toEqual([
      "2026-01-30T00:00:00.000Z",
      "2026-02-28T00:00:00.000Z",
      "2026-03-30T00:00:00.000Z",
    ]);
    expect(
      walkPeriods("MONTH", new Date("2028-01-29T00:00:00.000Z"), 3),
    ).toEqual([
      "2028-01-29T00:00:00.000Z",
      "2028-02-29T00:00:00.000Z",
      "2028-03-29T00:00:00.000Z",
    ]);

    // A 31st anchor mid-year: only the 30-day months clamp.
    expect(
      walkPeriods("MONTH", new Date("2026-05-31T00:00:00.000Z"), 5),
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
        expect(anchoredPeriodStart(window, anchor, inside).getTime()).toBe(
          anchor.getTime() + k * lengthMs,
        );
        expect(nextAnchoredResetAt(window, anchor, inside).getTime()).toBe(
          anchor.getTime() + (k + 1) * lengthMs,
        );
      }
    }

    // A week anchored on a Saturday rolls on Saturdays. The ISO Monday the
    // calendar window uses plays no part once a budget is anchored.
    const saturday = new Date("2026-03-07T13:42:17.500Z");
    expect(saturday.getUTCDay()).toBe(6);
    const nextWeek = nextAnchoredResetAt("WEEK", saturday, saturday);
    expect(nextWeek.getUTCDay()).toBe(6);
    expect(iso(nextWeek)).toBe("2026-03-14T13:42:17.500Z");
  });

  it("keeps a DAY cycle exactly 86400s apart across US and EU clock changes", () => {
    // US DST starts 2026-03-08, EU 2026-03-29. Neither exists in UTC, and
    // this is the assertion that keeps it that way.
    const anchor = new Date("2026-03-08T02:30:00.000Z");
    for (let k = 0; k <= 30; k++) {
      const inside = new Date(anchor.getTime() + k * 86_400_000 + 3_600_000);
      const start = anchoredPeriodStart("DAY", anchor, inside);
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
      expect(iso(anchoredPeriodStart(window, anchor, now))).toBe(iso(anchor));
      expect(iso(nextAnchoredResetAt(window, anchor, now))).toBe(iso(anchor));
    }
  });

  it("routes non-cycling windows to the sentinel whatever the anchor says", () => {
    const anchor = new Date("2026-06-17T09:00:00.000Z");
    const now = new Date("2026-07-15T00:00:00.000Z");
    for (const window of ["TOTAL", "MANUAL"] as const) {
      expect(
        nextBoundaryFor(
          { window, cycleAnchorAt: anchor },
          now,
        ).getUTCFullYear(),
      ).toBe(9999);
    }
    // Unanchored cyclic windows keep the calendar boundary.
    expect(
      iso(nextBoundaryFor({ window: "MONTH", cycleAnchorAt: null }, now)),
    ).toBe("2026-08-01T00:00:00.000Z");
    expect(
      iso(nextBoundaryFor({ window: "MONTH", cycleAnchorAt: anchor }, now)),
    ).toBe("2026-07-17T09:00:00.000Z");
  });
});

describe("budgetPeriodFloorMs on an anchored budget", () => {
  const anchor = new Date("2026-06-17T09:00:00.000Z");
  const createdAt = new Date("2026-06-17T09:00:00.000Z");

  /** @scenario "An anchored budget floors every read at its own period start" */
  it("floors every read at the anchored period start, reset or not", () => {
    // Unreset: the rollup buckets by calendar month and has no row for a
    // period that starts on the 17th, so the read must take the floor.
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: createdAt,
          lastResetAt: null,
          cycleAnchorAt: anchor,
        },
        new Date("2026-07-15T00:00:00.000Z"),
      ),
    ).toBe(new Date("2026-06-17T09:00:00.000Z").getTime());

    // After the anchored rollover the floor moves with it, so the spend that
    // was counted a moment ago now belongs to the closed period.
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: createdAt,
          lastResetAt: null,
          cycleAnchorAt: anchor,
        },
        new Date("2026-07-20T00:00:00.000Z"),
      ),
    ).toBe(new Date("2026-07-17T09:00:00.000Z").getTime());

    // A future anchor floors at the anchor: nothing has been spent in a
    // period that has not begun.
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: createdAt,
          lastResetAt: null,
          cycleAnchorAt: new Date("2026-09-01T00:00:00.000Z"),
        },
        new Date("2026-08-04T12:00:00.000Z"),
      ),
    ).toBe(new Date("2026-09-01T00:00:00.000Z").getTime());
  });

  /** @scenario "A reset inside an anchored period forgives spend until the next anchored boundary" */
  it("clamps to the reset instant, then expires exactly at the next anchored boundary", () => {
    const resetAt = new Date("2026-07-02T14:00:00.000Z");
    const row = {
      window: "MONTH" as const,
      currentPeriodStartedAt: resetAt,
      lastResetAt: resetAt,
      cycleAnchorAt: anchor,
    };

    // Inside the period the reset opened, the reset instant outranks the
    // anchored start: the forgiven spend stays forgiven.
    expect(budgetPeriodFloorMs(row, new Date("2026-07-10T00:00:00.000Z"))).toBe(
      resetAt.getTime(),
    );
    // One millisecond before the anchored boundary it still holds...
    expect(budgetPeriodFloorMs(row, new Date("2026-07-17T08:59:59.999Z"))).toBe(
      resetAt.getTime(),
    );
    // ...and at the boundary the cycle takes over again, unmoved by the
    // reset. A reset forgives spend; it never re-phases the cycle.
    expect(budgetPeriodFloorMs(row, new Date("2026-07-17T09:00:00.000Z"))).toBe(
      new Date("2026-07-17T09:00:00.000Z").getTime(),
    );
  });

  it("leaves MANUAL on its stored boundary even if an anchor is on the row", () => {
    const boundary = new Date("2026-07-10T09:30:00.000Z");
    expect(
      budgetPeriodFloorMs(
        {
          window: "MANUAL",
          currentPeriodStartedAt: boundary,
          lastResetAt: null,
          cycleAnchorAt: anchor,
        },
        new Date("2026-07-15T12:00:00.000Z"),
      ),
    ).toBe(boundary.getTime());
  });
});

describe("effectiveBudgetPeriod", () => {
  /** @scenario "The reported period is computed at read time, not stored" */
  it("reports the period a budget is in rather than the one its columns claim", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");

    // A calendar budget created in March and never reset: the stored columns
    // still say March, and nothing sweeps them forward. What enforcement
    // reads is the July period, and so is what the wire must say.
    const stale = {
      window: "MONTH" as const,
      currentPeriodStartedAt: new Date("2026-03-05T08:00:00.000Z"),
      resetsAt: new Date("2026-04-01T00:00:00.000Z"),
      lastResetAt: null,
      cycleAnchorAt: null,
    };
    expect(effectiveBudgetPeriod(stale, now)).toEqual({
      currentPeriodStartedAt: new Date("2026-07-01T00:00:00.000Z"),
      resetsAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    // An anchored budget reports its own bounds.
    const anchored = {
      window: "MONTH" as const,
      currentPeriodStartedAt: new Date("2026-06-17T09:00:00.000Z"),
      resetsAt: new Date("2026-07-17T09:00:00.000Z"),
      lastResetAt: null,
      cycleAnchorAt: new Date("2026-06-17T09:00:00.000Z"),
    };
    expect(effectiveBudgetPeriod(anchored, now)).toEqual({
      currentPeriodStartedAt: new Date("2026-06-17T09:00:00.000Z"),
      resetsAt: new Date("2026-07-17T09:00:00.000Z"),
    });

    // A calendar budget reset mid-period reports the reset instant, because
    // that is the bound its spend figure is actually read from.
    const resetAt = new Date("2026-07-10T09:30:00.000Z");
    expect(
      effectiveBudgetPeriod(
        {
          window: "MONTH",
          currentPeriodStartedAt: resetAt,
          resetsAt: new Date("2026-08-01T00:00:00.000Z"),
          lastResetAt: resetAt,
          cycleAnchorAt: null,
        },
        now,
      ),
    ).toEqual({
      currentPeriodStartedAt: resetAt,
      resetsAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    // TOTAL and MANUAL have no boundary to drift past, so their stored pair
    // passes through, sentinel and all.
    const sentinel = new Date(Date.UTC(9999, 11, 31));
    const manualStart = new Date("2026-02-01T00:00:00.000Z");
    for (const window of ["TOTAL", "MANUAL"] as const) {
      expect(
        effectiveBudgetPeriod(
          {
            window,
            currentPeriodStartedAt: manualStart,
            resetsAt: sentinel,
            lastResetAt: null,
            cycleAnchorAt: null,
          },
          now,
        ),
      ).toEqual({
        currentPeriodStartedAt: manualStart,
        resetsAt: sentinel,
      });
    }
  });
});

describe("GatewayBudgetService.create with a cycle anchor", () => {
  const REACHED_TRANSACTION = "REACHED_TRANSACTION";

  function mockPrisma(): PrismaClient {
    return {
      organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
      team: { findFirst: vi.fn().mockResolvedValue(null) },
      project: { findFirst: vi.fn().mockResolvedValue({ id: "project_1" }) },
      modelProvider: { findFirst: vi.fn().mockResolvedValue(null) },
      // Reaching here means the anchor was accepted.
      $transaction: vi.fn().mockRejectedValue(new Error(REACHED_TRANSACTION)),
    } as unknown as PrismaClient;
  }

  const baseInput = {
    organizationId: "org_1",
    scope: { kind: "PROJECT" as const, projectId: "project_1" },
    name: "ACME monthly allowance",
    limitUsd: 100,
    actorUserId: "user_1",
    cycleAnchorAt: new Date("2026-06-17T09:00:00.000Z"),
  };

  /** @scenario "A cycle anchor needs a cyclic window" */
  it("refuses an anchor on the two windows that do not cycle", async () => {
    for (const window of ["TOTAL", "MANUAL"] as const) {
      const sut = GatewayBudgetService.create(mockPrisma());
      await expect(sut.create({ ...baseInput, window })).rejects.toMatchObject({
        code: "gateway_budget_cycle_anchor_invalid",
        meta: { window: window.toLowerCase() },
      });
    }
  });

  it("accepts an anchor on a cyclic window", async () => {
    const sut = GatewayBudgetService.create(mockPrisma());
    await expect(sut.create({ ...baseInput, window: "MONTH" })).rejects.toThrow(
      REACHED_TRANSACTION,
    );
  });

  it("leaves the two non-cycling windows alone when no anchor is sent", async () => {
    for (const window of ["TOTAL", "MANUAL"] as const) {
      const sut = GatewayBudgetService.create(mockPrisma());
      await expect(
        sut.create({ ...baseInput, window, cycleAnchorAt: null }),
      ).rejects.toThrow(REACHED_TRANSACTION);
    }
  });
});

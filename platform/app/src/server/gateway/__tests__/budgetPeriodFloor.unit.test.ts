import { describe, expect, it } from "vitest";
import {
  budgetPeriodFloorMs,
  currentPeriodStart,
} from "../budget.clickhouse.repository";
import { nextResetAt, shouldResetBudget } from "../budgetWindow";

const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("MANUAL window math", () => {
  /** @scenario A MANUAL window never resets on its own */
  it("never resets on its own", () => {
    const resetsAt = nextResetAt("MANUAL", NOW);
    expect(resetsAt.getUTCFullYear()).toBe(9999);
    expect(shouldResetBudget("MANUAL", resetsAt, NOW)).toBe(false);
    // Sentinel timestamps still answer no: the boundary only moves by an
    // explicit reset, whatever the clock says.
    expect(
      shouldResetBudget("MANUAL", new Date("2000-01-01T00:00:00Z"), NOW),
    ).toBe(false);
  });

  it("buckets MANUAL debits under the epoch sentinel like TOTAL", () => {
    expect(currentPeriodStart("MANUAL", NOW).getTime()).toBe(0);
    expect(currentPeriodStart("TOTAL", NOW).getTime()).toBe(0);
  });
});

describe("budgetPeriodFloorMs", () => {
  const boundary = new Date("2026-07-10T09:30:00.000Z");

  /** @scenario The period floor follows the stored boundary, not the calendar */
  it("floors MANUAL always, reset calendars until the edge passes, unreset TOTAL never", () => {
    expect(
      budgetPeriodFloorMs(
        {
          window: "MANUAL",
          currentPeriodStartedAt: boundary,
          lastResetAt: null,
        },
        NOW,
      ),
    ).toBe(boundary.getTime());

    // A MONTH budget reset on the 10th reads from the 10th for the rest
    // of July (the calendar period start, July 1st, is behind it)...
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: boundary,
          lastResetAt: boundary,
        },
        NOW,
      ),
    ).toBe(boundary.getTime());
    // ...and back on the fast path once August starts.
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: boundary,
          lastResetAt: boundary,
        },
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).toBeUndefined();

    // An unreset budget never floors: TOTAL keeps its lifetime bucket
    // semantics even though its stored boundary is its creation time.
    expect(
      budgetPeriodFloorMs(
        {
          window: "TOTAL",
          currentPeriodStartedAt: boundary,
          lastResetAt: null,
        },
        NOW,
      ),
    ).toBeUndefined();
    expect(
      budgetPeriodFloorMs(
        {
          window: "MONTH",
          currentPeriodStartedAt: boundary,
          lastResetAt: null,
        },
        NOW,
      ),
    ).toBeUndefined();
  });
});

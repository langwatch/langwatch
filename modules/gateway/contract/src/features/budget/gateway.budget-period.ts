/**
 * Which period a budget is in, and the lower bound a spend read for it must honor.
 */
import { type Instant, nowInstant, Temporal } from "@langwatch/time";

import { GatewayWindow, resolveBudgetTimeZone } from "./gateway.budget-window.ts";
import type { GatewayBudgetWindow } from "./gateway.budget.ts";

/** The fields every period computation reads off a budget. */
export type BudgetPeriodFields = {
  window: GatewayBudgetWindow;
  currentPeriodStartedAt: Instant;
  lastResetAt: Instant | null;
  cycleAnchorAt: Instant | null;
  /** IANA zone the calendar windows roll in; null or empty means UTC. */
  timezone: string | null;
};

/**
 * The OccurredAt lower bound a spend read must honor for a budget whose period boundary is not
 * the UTC calendar one the rollup keys on, or undefined for the rollup fast path. MANUAL
 * windows always read from their stored boundary.
 */
export function computeBudgetPeriodFloorMs(
  budget: BudgetPeriodFields,
  now: Instant = nowInstant(),
): number | undefined {
  if (budget.window === "MANUAL") {
    return budget.currentPeriodStartedAt.epochMilliseconds;
  }
  if (budget.cycleAnchorAt && GatewayWindow.isCyclicWindow(budget.window)) {
    const anchored = GatewayWindow.anchoredPeriodStart({
      window: budget.window,
      anchorAt: budget.cycleAnchorAt,
      now,
    }).epochMilliseconds;
    // A reset forgives the spend so far but never re-phases the cycle: the
    // clamp holds only until this period ends, and the next one starts on
    // the anchor's schedule as if the reset had not happened. Same shape as
    // the calendar clamp below, with the anchored boundary in place of the
    // calendar one.
    return budget.lastResetAt
      ? Math.max(anchored, budget.currentPeriodStartedAt.epochMilliseconds)
      : anchored;
  }
  const rollupStartMs = currentPeriodStart(budget.window, now).epochMilliseconds;
  const calendarStartMs = budgetCalendarPeriodStart(budget, now).epochMilliseconds;
  const resetMs = budget.lastResetAt ? budget.currentPeriodStartedAt.epochMilliseconds : undefined;
  // A local-midnight period that is not the UTC one has no rollup bucket, so it is read from
  // raw events off its own start.
  if (calendarStartMs !== rollupStartMs) {
    return resetMs !== undefined ? Math.max(calendarStartMs, resetMs) : calendarStartMs;
  }
  return resetMs !== undefined && resetMs > rollupStartMs ? resetMs : undefined;
}

/** Start of the calendar period a budget is in, on its own timezone's wall clock. */
export function budgetCalendarPeriodStart(
  budget: { window: GatewayBudgetWindow; timezone: string | null },
  now: Instant = nowInstant(),
): Instant {
  return GatewayWindow.calendarPeriodStart({
    window: budget.window,
    now,
    timezone: resolveBudgetTimeZone(budget.timezone),
  });
}

/**
 * The period a budget is actually in right now, as opposed to the one its stored columns claim.
 * `currentPeriodStartedAt` and `resetsAt` are written once at create and again at each explicit
 * reset, and nothing sweeps them forward when a period rolls.
 */
export function effectiveBudgetPeriod(
  budget: BudgetPeriodFields & { resetsAt: Instant },
  now: Instant = nowInstant(),
): { currentPeriodStartedAt: Instant; resetsAt: Instant } {
  if (!GatewayWindow.isCyclicWindow(budget.window)) {
    return {
      currentPeriodStartedAt: budget.currentPeriodStartedAt,
      resetsAt: budget.resetsAt,
    };
  }
  const floorMs = computeBudgetPeriodFloorMs(budget, now);
  return {
    currentPeriodStartedAt:
      floorMs === undefined
        ? budgetCalendarPeriodStart(budget, now)
        : Temporal.Instant.fromEpochMilliseconds(floorMs),
    resetsAt: GatewayWindow.nextBoundaryFor({ budget, now }),
  };
}

/**
 * The OccurredAt lower bound for ONE bucket of a budget: the later of the budget's own period
 * floor and that bucket's boundary row, whichever of the two exist.
 */
export function computeBucketPeriodFloorMs(
  budget: BudgetPeriodFields,
  boundaryPeriodStartedAt: Instant | null | undefined,
  now: Instant = nowInstant(),
): number | undefined {
  const candidates = [
    computeBudgetPeriodFloorMs(budget, now),
    boundaryPeriodStartedAt?.epochMilliseconds,
  ].filter((n): n is number => typeof n === "number");
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

/**
 * Start-of-period (UTC) for the current window: the rollup's PeriodStart key. The rollup only
 * returns a row when this lands on exactly the PeriodStart the materialised view bucketed the
 * debit into (ISO weeks match toStartOfWeek(t, 1)). TOTAL and MANUAL key on the epoch.
 */
export function currentPeriodStart(window: GatewayBudgetWindow, now: Instant): Instant {
  return GatewayWindow.calendarPeriodStart({ window, now, timezone: "UTC" });
}

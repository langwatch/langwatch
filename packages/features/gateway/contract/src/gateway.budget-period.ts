/**
 * Which period a budget is in, and the lower bound a spend read for it must honor.
 */
import type { GatewayBudgetWindow } from "./gateway.budget";
import { GatewayWindow } from "./gateway.budget-window";

/**
 * The OccurredAt lower bound a spend read must honor for a budget whose period boundary is not
 * the calendar one, or undefined for the rollup fast path. MANUAL windows always read from
 * their stored boundary.
 */
export function budgetPeriodFloorMs(
  budget: {
    window: GatewayBudgetWindow;
    currentPeriodStartedAt: Date;
    lastResetAt: Date | null;
    cycleAnchorAt: Date | null;
  },
  now: Date = new Date(),
): number | undefined {
  if (budget.window === "MANUAL") {
    return budget.currentPeriodStartedAt.getTime();
  }
  if (budget.cycleAnchorAt && GatewayWindow.isCyclicWindow(budget.window)) {
    const anchored = GatewayWindow.anchoredPeriodStart({
      window: budget.window,
      anchorAt: budget.cycleAnchorAt,
      now,
    }).getTime();
    // A reset forgives the spend so far but never re-phases the cycle: the
    // clamp holds only until this period ends, and the next one starts on
    // the anchor's schedule as if the reset had not happened. Same shape as
    // the calendar clamp below, with the anchored boundary in place of the
    // calendar one.
    return budget.lastResetAt
      ? Math.max(anchored, budget.currentPeriodStartedAt.getTime())
      : anchored;
  }
  if (!budget.lastResetAt) return undefined;
  const boundary = budget.currentPeriodStartedAt.getTime();
  return boundary > currentPeriodStart(budget.window, now).getTime() ? boundary : undefined;
}

/**
 * The period a budget is actually in right now, as opposed to the one its stored columns claim.
 * `currentPeriodStartedAt` and `resetsAt` are written once at create and again at each explicit
 * reset, and nothing sweeps them forward when a period rolls.
 */
export function effectiveBudgetPeriod(
  budget: {
    window: GatewayBudgetWindow;
    currentPeriodStartedAt: Date;
    resetsAt: Date;
    lastResetAt: Date | null;
    cycleAnchorAt: Date | null;
  },
  now: Date = new Date(),
): { currentPeriodStartedAt: Date; resetsAt: Date } {
  if (!GatewayWindow.isCyclicWindow(budget.window)) {
    return {
      currentPeriodStartedAt: budget.currentPeriodStartedAt,
      resetsAt: budget.resetsAt,
    };
  }
  const floorMs = budgetPeriodFloorMs(budget, now);
  return {
    currentPeriodStartedAt:
      floorMs === undefined ? currentPeriodStart(budget.window, now) : new Date(floorMs),
    resetsAt: GatewayWindow.nextBoundaryFor({ budget, now }),
  };
}

/**
 * The OccurredAt lower bound for ONE bucket of a budget: the later of the budget's own period
 * floor and that bucket's boundary row, whichever of the two exist.
 */
export function bucketPeriodFloorMs(
  budget: {
    window: GatewayBudgetWindow;
    currentPeriodStartedAt: Date;
    lastResetAt: Date | null;
    cycleAnchorAt: Date | null;
  },
  boundaryPeriodStartedAt: Date | null | undefined,
  now: Date = new Date(),
): number | undefined {
  const candidates = [budgetPeriodFloorMs(budget, now), boundaryPeriodStartedAt?.getTime()].filter(
    (n): n is number => typeof n === "number",
  );
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

/**
 * Start-of-period (UTC) for the current window. This is one half of a contract: the rollup only
 * ever returns a row when this lands on exactly the PeriodStart the materialised view bucketed
 * the debit into.
 */
export function currentPeriodStart(window: GatewayBudgetWindow, now: Date): Date {
  const d = new Date(now.getTime());
  if (window === "MINUTE") {
    d.setUTCSeconds(0, 0);
    return d;
  }
  if (window === "HOUR") {
    d.setUTCMinutes(0, 0, 0);
    return d;
  }
  if (window === "DAY") {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (window === "WEEK") {
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    // ISO week start (Monday). Matches ClickHouse toStartOfWeek(t, 1).
    const delta = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - delta);
    return d;
  }
  if (window === "MONTH") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  // TOTAL and MANUAL: one lifetime bucket, keyed by the epoch sentinel
  // (the MV's multiIf falls through to epoch for both). MANUAL is never
  // read through the PeriodStart fast path (budgetPeriodFloorMs always
  // floors it onto the raw-events read); the sentinel only keys where its
  // debits land in the rollup.
  return new Date(0);
}

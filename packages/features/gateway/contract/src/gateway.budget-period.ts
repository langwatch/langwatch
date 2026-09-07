/**
 * Which period a budget is in, and the lower bound a spend read for it must honor.
 */
import { type Instant, nowInstant, Temporal } from "@langwatch/time";
import type { GatewayBudgetWindow } from "./gateway.budget.ts";
import { GatewayWindow } from "./gateway.budget-window.ts";

/**
 * The OccurredAt lower bound a spend read must honor for a budget whose period boundary is not
 * the calendar one, or undefined for the rollup fast path. MANUAL windows always read from
 * their stored boundary.
 */
export function budgetPeriodFloorMs(
  budget: {
    window: GatewayBudgetWindow;
    currentPeriodStartedAt: Instant;
    lastResetAt: Instant | null;
    cycleAnchorAt: Instant | null;
  },
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
  if (!budget.lastResetAt) return undefined;
  const boundary = budget.currentPeriodStartedAt.epochMilliseconds;
  return boundary > currentPeriodStart(budget.window, now).epochMilliseconds ? boundary : undefined;
}

/**
 * The period a budget is actually in right now, as opposed to the one its stored columns claim.
 * `currentPeriodStartedAt` and `resetsAt` are written once at create and again at each explicit
 * reset, and nothing sweeps them forward when a period rolls.
 */
export function effectiveBudgetPeriod(
  budget: {
    window: GatewayBudgetWindow;
    currentPeriodStartedAt: Instant;
    resetsAt: Instant;
    lastResetAt: Instant | null;
    cycleAnchorAt: Instant | null;
  },
  now: Instant = nowInstant(),
): { currentPeriodStartedAt: Instant; resetsAt: Instant } {
  if (!GatewayWindow.isCyclicWindow(budget.window)) {
    return {
      currentPeriodStartedAt: budget.currentPeriodStartedAt,
      resetsAt: budget.resetsAt,
    };
  }
  const floorMs = budgetPeriodFloorMs(budget, now);
  return {
    currentPeriodStartedAt:
      floorMs === undefined
        ? currentPeriodStart(budget.window, now)
        : Temporal.Instant.fromEpochMilliseconds(floorMs),
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
    currentPeriodStartedAt: Instant;
    lastResetAt: Instant | null;
    cycleAnchorAt: Instant | null;
  },
  boundaryPeriodStartedAt: Instant | null | undefined,
  now: Instant = nowInstant(),
): number | undefined {
  const candidates = [
    budgetPeriodFloorMs(budget, now),
    boundaryPeriodStartedAt?.epochMilliseconds,
  ].filter((n): n is number => typeof n === "number");
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

/**
 * Start-of-period (UTC) for the current window. This is one half of a contract: the rollup only
 * ever returns a row when this lands on exactly the PeriodStart the materialised view bucketed
 * the debit into.
 */
export function currentPeriodStart(window: GatewayBudgetWindow, now: Instant): Instant {
  const clock = now
    .toZonedDateTimeISO("UTC")
    .with({ millisecond: 0, microsecond: 0, nanosecond: 0 });
  if (window === "MINUTE") {
    return clock.with({ second: 0 }).toInstant();
  }
  if (window === "HOUR") {
    return clock.with({ minute: 0, second: 0 }).toInstant();
  }
  if (window === "DAY") {
    return clock.startOfDay().toInstant();
  }
  if (window === "WEEK") {
    // ISO week start (Monday). Matches ClickHouse toStartOfWeek(t, 1).
    const day = clock.dayOfWeek % 7;
    const delta = day === 0 ? 6 : day - 1;
    return clock.startOfDay().subtract({ days: delta }).toInstant();
  }
  if (window === "MONTH") {
    return clock.startOfDay().with({ day: 1 }).toInstant();
  }
  // TOTAL and MANUAL: one lifetime bucket, keyed by the epoch sentinel
  // (the MV's multiIf falls through to epoch for both). MANUAL is never
  // read through the PeriodStart fast path (budgetPeriodFloorMs always
  // floors it onto the raw-events read); the sentinel only keys where its
  // debits land in the rollup.
  return Temporal.Instant.fromEpochMilliseconds(0);
}

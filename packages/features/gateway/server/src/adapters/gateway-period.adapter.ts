/**
 * Which period a budget is in, and the lower bound a spend read for it must
 * honor. Pure functions over a budget row — no DB, no I/O.
 *
 * Separate from `budgetWindow.ts`, which answers the same questions for a
 * window in the abstract: this module is the layer that reads the stored
 * columns of a row and decides which of the two schedules, calendar or
 * anchored, that row is actually on.
 *
 * Domain-level on purpose. The ClickHouse repository reads these floors to
 * bound a query, but so do the DTO, the config materialiser and the REST
 * surfaces, and none of those should reach into infrastructure to find out
 * what period a budget is in.
 */
import type { GatewayBudgetWindow } from "@langwatch/gateway-contract";

import { GatewayWindow } from "./gateway-window.adapter";

/**
 * The OccurredAt lower bound a spend read must honor for a budget whose
 * period boundary is not the calendar one, or undefined for the rollup
 * fast path. MANUAL windows always read from their stored boundary. An
 * anchored budget always reads from its own period start, since the rollup
 * buckets by calendar period and has no row that matches an anchored one. A
 * calendar (or TOTAL) window reads from the boundary only after an actual
 * mid-period reset (lastResetAt set) and only until the next calendar
 * boundary passes it; an unreset TOTAL budget keeps its lifetime-bucket
 * semantics.
 *
 * `cycleAnchorAt` is required rather than optional so that a caller reading
 * a budget row cannot forget it and silently get a calendar floor for an
 * anchored budget, which would count another period's spend against it.
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
 * The period a budget is actually in right now, as opposed to the one its
 * stored columns claim.
 *
 * `currentPeriodStartedAt` and `resetsAt` are written once at create and
 * again at each explicit reset, and nothing sweeps them forward when a
 * period rolls. For a calendar budget past its first boundary the stored
 * start is therefore its creation date and the stored reset instant is in
 * the past, while enforcement has long since moved on to the current
 * calendar period. Reporting the stored pair tells a caller their month
 * started in March.
 *
 * So every read-side surface computes the pair here instead: anchored
 * budgets report their anchored bounds, cyclic ones their calendar bounds
 * (clamped forward by a mid-period reset, exactly as the floor is), and
 * TOTAL / MANUAL pass their stored values through since those windows have
 * no boundary to drift past.
 *
 * `now` is the instant the period is resolved at, and a caller that has
 * already read spend must pass the instant it read at: a boundary crossed
 * between the two would otherwise print the new period beside the previous
 * period's figure.
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
 * The OccurredAt lower bound for ONE bucket of a budget: the later of the
 * budget's own period floor and that bucket's boundary row, whichever of
 * the two exist. A per-bucket reset moves only its own boundary, so a read
 * that ignored it would keep counting spend the reset forgave; a template
 * reset moves the budget floor and outranks a stale bucket boundary.
 *
 * There is no calendar clamp here on purpose: enforcement reads the same
 * floor, and a display that clamped would disagree with the figure that
 * actually blocks a request.
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
 * Start-of-period (UTC) for the current window.
 *
 * This is one half of a contract: the rollup only ever returns a row when
 * this lands on exactly the PeriodStart the materialised view bucketed the
 * debit into. The other half is the multiIf() in
 * 00070_gateway_budget_ledger_nano_usd.sql, which carries forward the
 * bucketing 00069 established, and the two are pinned together by
 * budget.clickhouse.repository.periodStart.integration.test.ts. Change one
 * without the other and the affected window stops accruing entirely: spend
 * is written, every read returns 0, and budgets on that window silently
 * stop enforcing.
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

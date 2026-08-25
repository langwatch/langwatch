/**
 * Budget window math. Pure functions — no DB, no I/O. Given a window type
 * and an anchor time, compute the next reset instant.
 *
 * For now windows are computed in UTC. An org-level timezone override is on
 * the roadmap (see contract §12 open question); when we add it, this module
 * gets a `timezone?: string` parameter and defers to a date library.
 */
import type { GatewayBudgetWindow } from "~/generated/prisma/client";

export function nextResetAt(window: GatewayBudgetWindow, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCMilliseconds(0);

  switch (window) {
    case "MINUTE": {
      d.setUTCSeconds(0);
      d.setUTCMinutes(d.getUTCMinutes() + 1);
      return d;
    }
    case "HOUR": {
      d.setUTCSeconds(0);
      d.setUTCMinutes(0);
      d.setUTCHours(d.getUTCHours() + 1);
      return d;
    }
    case "DAY": {
      d.setUTCSeconds(0);
      d.setUTCMinutes(0);
      d.setUTCHours(0);
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    }
    case "WEEK": {
      // Reset on Monday 00:00 UTC. getUTCDay(): Sun=0, Mon=1, ..., Sat=6.
      d.setUTCSeconds(0);
      d.setUTCMinutes(0);
      d.setUTCHours(0);
      const day = d.getUTCDay();
      const daysUntilNextMonday = day === 1 ? 7 : (8 - day) % 7;
      d.setUTCDate(d.getUTCDate() + daysUntilNextMonday);
      return d;
    }
    case "MONTH": {
      d.setUTCSeconds(0);
      d.setUTCMinutes(0);
      d.setUTCHours(0);
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    }
    case "TOTAL": {
      // Sentinel — never resets. Use far-future to keep sort orders sensible.
      return new Date(Date.UTC(9999, 11, 31));
    }
    case "MANUAL": {
      // The boundary moves only through an explicit reset; until then the
      // window is open-ended. Same far-future sentinel as TOTAL.
      return new Date(Date.UTC(9999, 11, 31));
    }
  }
}

/**
 * The windows that roll on their own. TOTAL and MANUAL are the two that do
 * not: one never rolls, the other rolls only when someone asks it to, so
 * neither has a cycle for an anchor to phase.
 */
export type CyclicWindow = Exclude<GatewayBudgetWindow, "TOTAL" | "MANUAL">;

export const CYCLIC_WINDOWS = [
  "MINUTE",
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
] as const satisfies readonly CyclicWindow[];

export function isCyclicWindow(window: GatewayBudgetWindow): window is CyclicWindow {
  return (CYCLIC_WINDOWS as readonly GatewayBudgetWindow[]).includes(window);
}

/**
 * Fixed-length windows: every period is exactly this many milliseconds, so
 * an anchored period start is plain modulo arithmetic off the anchor.
 *
 * These lengths are wall-clock UTC and DST cannot reach them: the whole
 * module works in epoch milliseconds and UTC calendar fields, so a DAY
 * anchored at 02:30Z stays 86400s apart through every local clock change.
 */
const FIXED_CYCLE_MS: Record<Exclude<CyclicWindow, "MONTH">, number> = {
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 604_800_000,
};

function daysInUtcMonth({
  year,
  monthIndex,
}: {
  year: number;
  monthIndex: number;
}): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * The start of the nth monthly cycle after `anchorAt`, clamped into months
 * too short to hold the anchor's day.
 *
 * The clamp reads the day off the ORIGINAL anchor every time and never
 * rewrites it, which is what makes a 31st anchor spring back: Jan 31 gives
 * Feb 28, then Mar 31 again, not Mar 28. Rewriting the day on the short
 * month would walk the cycle backwards a few days a year until it settled
 * on the 28th, silently moving a customer's billing day.
 */
function monthlyCycleStart({
  anchorAt,
  cycles,
}: {
  anchorAt: Date;
  cycles: number;
}): Date {
  const anchorDay = anchorAt.getUTCDate();
  // Date.UTC normalises month overflow and underflow into the year.
  const normalised = new Date(
    Date.UTC(anchorAt.getUTCFullYear(), anchorAt.getUTCMonth() + cycles, 1),
  );
  const year = normalised.getUTCFullYear();
  const monthIndex = normalised.getUTCMonth();
  return new Date(
    Date.UTC(
      year,
      monthIndex,
      Math.min(anchorDay, daysInUtcMonth({ year, monthIndex })),
      anchorAt.getUTCHours(),
      anchorAt.getUTCMinutes(),
      anchorAt.getUTCSeconds(),
      anchorAt.getUTCMilliseconds(),
    ),
  );
}

/**
 * Start of the anchored period containing `now`, for a budget whose cycle
 * is phased to `anchorAt` instead of the calendar.
 *
 * Boundaries belong to the period they open: at the exact boundary instant
 * this returns that instant, which is the bound a spend read compares with
 * `OccurredAt >= floor`, so no debit can land in the gap between two
 * periods.
 *
 * Before the anchor there is no period yet, and this returns the anchor
 * itself. A read floored there totals nothing, which is what makes a future
 * anchor ("start on the 1st of next month") work without a special case
 * anywhere downstream.
 */
export function anchoredPeriodStart({
  window,
  anchorAt,
  now = new Date(),
}: {
  window: CyclicWindow;
  anchorAt: Date;
  now?: Date;
}): Date {
  const anchorMs = anchorAt.getTime();
  if (now.getTime() < anchorMs) return new Date(anchorMs);

  if (window !== "MONTH") {
    const length = FIXED_CYCLE_MS[window];
    const elapsed = now.getTime() - anchorMs;
    return new Date(anchorMs + Math.floor(elapsed / length) * length);
  }

  // Months are not a fixed length, so count them as calendar months and
  // step back one if the clamped start of the month `now` falls in has not
  // arrived yet (anchored on the 17th, now the 3rd: still last month's
  // period). One step is always enough, because the previous cycle starts
  // in the previous month and so before every instant in this one.
  let cycles =
    (now.getUTCFullYear() - anchorAt.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchorAt.getUTCMonth());
  if (monthlyCycleStart({ anchorAt, cycles }).getTime() > now.getTime()) {
    cycles -= 1;
  }
  if (cycles < 0) return new Date(anchorMs);
  return monthlyCycleStart({ anchorAt, cycles });
}

/**
 * The instant the anchored period containing `now` gives way to the next.
 * Before the anchor that is the anchor itself: the first period opens then.
 */
export function nextAnchoredResetAt({
  window,
  anchorAt,
  now = new Date(),
}: {
  window: CyclicWindow;
  anchorAt: Date;
  now?: Date;
}): Date {
  const anchorMs = anchorAt.getTime();
  if (now.getTime() < anchorMs) return new Date(anchorMs);

  if (window !== "MONTH") {
    return new Date(
      anchoredPeriodStart({ window, anchorAt, now }).getTime() + FIXED_CYCLE_MS[window],
    );
  }

  const start = anchoredPeriodStart({ window, anchorAt, now });
  const elapsedMonths =
    (start.getUTCFullYear() - anchorAt.getUTCFullYear()) * 12 +
    (start.getUTCMonth() - anchorAt.getUTCMonth());
  return monthlyCycleStart({ anchorAt, cycles: elapsedMonths + 1 });
}

/**
 * The next boundary for a budget however it is phased: its own anchored
 * schedule when it carries an anchor, the calendar otherwise. TOTAL and
 * MANUAL keep the far-future sentinel whether or not a stray anchor sits on
 * the row, because neither window rolls.
 */
export function nextBoundaryFor({
  budget,
  now = new Date(),
}: {
  budget: { window: GatewayBudgetWindow; cycleAnchorAt: Date | null };
  now?: Date;
}): Date {
  if (budget.cycleAnchorAt && isCyclicWindow(budget.window)) {
    return nextAnchoredResetAt({
      window: budget.window,
      anchorAt: budget.cycleAnchorAt,
      now,
    });
  }
  return nextResetAt(budget.window, now);
}

export function shouldResetBudget(
  window: GatewayBudgetWindow,
  resetsAt: Date | string,
  now: Date = new Date(),
): boolean {
  if (window === "TOTAL" || window === "MANUAL") return false;
  const resetTs = typeof resetsAt === "string" ? new Date(resetsAt) : resetsAt;
  return now.getTime() >= resetTs.getTime();
}

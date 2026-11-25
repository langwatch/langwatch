/**
 * Budget window math. Pure functions — no DB, no I/O. Given a window type and an anchor time,
 * compute the next reset instant. Calendar windows roll at midnight in the budget's timezone
 * (UTC when it has none); anchored windows follow their anchor.
 */
import { type Instant, nowInstant, Temporal, toEpochMs, type ZonedDateTime } from "@langwatch/time";

import type { GatewayBudgetWindow } from "./gateway.budget.ts";

const UTC = "UTC";

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

/**
 * Fixed-length windows: every period is exactly this many milliseconds, so an anchored period
 * start is plain modulo arithmetic off the anchor.
 */
const FIXED_CYCLE_MS: Record<Exclude<CyclicWindow, "MONTH">, number> = {
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 604_800_000,
};

/** The far-future sentinel TOTAL and MANUAL reset at: they never roll. */
const NEVER_RESETS_AT = Temporal.PlainDateTime.from({ year: 9999, month: 12, day: 31 })
  .toZonedDateTime(UTC)
  .toInstant();

/** UTC wall clock for an instant. Anchored cycles are computed on it. */
function utcClock(at: Instant): ZonedDateTime {
  return at.toZonedDateTimeISO(UTC);
}

/**
 * The IANA zone a budget's calendar windows roll in. Empty, missing or unknown names fall back
 * to UTC, so a bad value on a row can never stop enforcement.
 */
export function resolveBudgetTimeZone(timezone: string | null | undefined): string {
  const name = timezone?.trim();
  if (!name) return UTC;
  try {
    return Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(name).timeZoneId;
  } catch {
    return UTC;
  }
}

/**
 * When a budget's window starts, ends and resets. Two families of answer live here and must not
 * be confused: the calendar ones, where a MONTH budget rolls on the first, and the anchored
 * ones, where it rolls on the phase the budget was given.
 */
export class GatewayWindow {
  /**
   * The start of the nth monthly cycle after `anchorAt`, clamped into months too short to hold
   * the anchor's day.
   */
  private static monthlyCycleStart({
    anchorAt,
    cycles,
  }: {
    anchorAt: Instant;
    cycles: number;
  }): Instant {
    const anchor = utcClock(anchorAt);
    // PlainYearMonth normalises month overflow and underflow into the year.
    const month = Temporal.PlainYearMonth.from({
      year: anchor.year,
      month: anchor.month,
    }).add({ months: cycles });
    return Temporal.PlainDateTime.from({
      year: month.year,
      month: month.month,
      day: Math.min(anchor.day, month.daysInMonth),
      hour: anchor.hour,
      minute: anchor.minute,
      second: anchor.second,
      millisecond: anchor.millisecond,
    })
      .toZonedDateTime(UTC)
      .toInstant();
  }

  /**
   * First instant of the current calendar month, UTC. The default floor of every spend window:
   * a read with no `from` reports the month to date, and both doors into the gateway take it
   * from here so the default cannot be phrased two ways.
   */
  static startOfCurrentMonthUTC(now: Instant = nowInstant()): Instant {
    return utcClock(now).with({ day: 1 }).startOfDay().toInstant();
  }

  static isCyclicWindow(window: GatewayBudgetWindow): window is CyclicWindow {
    return (CYCLIC_WINDOWS as readonly GatewayBudgetWindow[]).includes(window);
  }

  /**
   * Start of the anchored period containing `now`, for a budget whose cycle is phased to
   * `anchorAt` instead of the calendar.
   */
  static anchoredPeriodStart({
    window,
    anchorAt,
    now = nowInstant(),
  }: {
    window: CyclicWindow;
    anchorAt: Instant;
    now?: Instant;
  }): Instant {
    const anchorMs = anchorAt.epochMilliseconds;
    const nowMs = now.epochMilliseconds;
    if (nowMs < anchorMs) return Temporal.Instant.fromEpochMilliseconds(anchorMs);

    if (window !== "MONTH") {
      const length = FIXED_CYCLE_MS[window];
      const elapsed = nowMs - anchorMs;
      return Temporal.Instant.fromEpochMilliseconds(
        anchorMs + Math.floor(elapsed / length) * length,
      );
    }

    // Months are not a fixed length, so count them as calendar months and
    // step back one if the clamped start of the month `now` falls in has not
    // arrived yet (anchored on the 17th, now the 3rd: still last month's
    // period). One step is always enough, because the previous cycle starts
    // in the previous month and so before every instant in this one.
    const anchor = utcClock(anchorAt);
    const clock = utcClock(now);
    let cycles = (clock.year - anchor.year) * 12 + (clock.month - anchor.month);
    if (GatewayWindow.monthlyCycleStart({ anchorAt, cycles }).epochMilliseconds > nowMs) {
      cycles -= 1;
    }
    if (cycles < 0) return Temporal.Instant.fromEpochMilliseconds(anchorMs);
    return GatewayWindow.monthlyCycleStart({ anchorAt, cycles });
  }

  /**
   * The instant the anchored period containing `now` gives way to the next.
   * Before the anchor that is the anchor itself: the first period opens then.
   */
  static nextAnchoredResetAt({
    window,
    anchorAt,
    now = nowInstant(),
  }: {
    window: CyclicWindow;
    anchorAt: Instant;
    now?: Instant;
  }): Instant {
    const anchorMs = anchorAt.epochMilliseconds;
    if (now.epochMilliseconds < anchorMs) return Temporal.Instant.fromEpochMilliseconds(anchorMs);

    if (window !== "MONTH") {
      return Temporal.Instant.fromEpochMilliseconds(
        GatewayWindow.anchoredPeriodStart({ window, anchorAt, now }).epochMilliseconds +
          FIXED_CYCLE_MS[window],
      );
    }

    const anchor = utcClock(anchorAt);
    const start = utcClock(GatewayWindow.anchoredPeriodStart({ window, anchorAt, now }));
    const elapsedMonths = (start.year - anchor.year) * 12 + (start.month - anchor.month);
    return GatewayWindow.monthlyCycleStart({ anchorAt, cycles: elapsedMonths + 1 });
  }

  /**
   * Start of the calendar period containing `now`. Day, week (ISO, Monday) and month start at
   * local midnight in `timezone`, so DST gives a 23 or 25 hour day; minute and hour stay on UTC,
   * since a half-hour offset zone would start its hour at :30 and miss the UTC rollup.
   */
  static calendarPeriodStart({
    window,
    now = nowInstant(),
    timezone,
  }: {
    window: GatewayBudgetWindow;
    now?: Instant;
    timezone?: string | null;
  }): Instant {
    const zone = window === "MINUTE" || window === "HOUR" ? UTC : resolveBudgetTimeZone(timezone);
    const clock = now
      .toZonedDateTimeISO(zone)
      .with({ millisecond: 0, microsecond: 0, nanosecond: 0 });
    switch (window) {
      case "MINUTE":
        return clock.with({ second: 0 }).toInstant();
      case "HOUR":
        return clock.with({ minute: 0, second: 0 }).toInstant();
      case "DAY":
        return clock.startOfDay().toInstant();
      case "WEEK":
        return clock
          .toPlainDate()
          .subtract({ days: clock.dayOfWeek - 1 })
          .toZonedDateTime(clock.timeZoneId)
          .toInstant();
      case "MONTH":
        return clock.toPlainDate().with({ day: 1 }).toZonedDateTime(clock.timeZoneId).toInstant();
      case "TOTAL":
      case "MANUAL":
        return Temporal.Instant.fromEpochMilliseconds(0);
    }
  }

  static nextResetAt(
    window: GatewayBudgetWindow,
    now: Instant = nowInstant(),
    timezone?: string | null,
  ): Instant {
    const zone = resolveBudgetTimeZone(timezone);
    const start = GatewayWindow.calendarPeriodStart({ window, now, timezone: zone });
    const clock = start.toZonedDateTimeISO(zone);

    switch (window) {
      case "MINUTE":
        return clock.add({ minutes: 1 }).toInstant();
      case "HOUR":
        return clock.add({ hours: 1 }).toInstant();
      case "DAY":
        return clock.toPlainDate().add({ days: 1 }).toZonedDateTime(zone).toInstant();
      case "WEEK":
        return clock.toPlainDate().add({ days: 7 }).toZonedDateTime(zone).toInstant();
      case "MONTH":
        return clock.toPlainDate().add({ months: 1 }).toZonedDateTime(zone).toInstant();
      case "TOTAL":
      case "MANUAL":
        // Neither rolls: TOTAL never resets, MANUAL moves only through an
        // explicit reset. The far-future sentinel keeps sort orders sensible.
        return NEVER_RESETS_AT;
    }
  }

  /**
   * The next boundary for a budget however it is phased: its own anchored schedule when it
   * carries an anchor, the calendar otherwise. TOTAL and MANUAL keep the far-future sentinel
   * whether or not a stray anchor sits on the row, because neither window rolls.
   */
  static nextBoundaryFor({
    budget,
    now = nowInstant(),
  }: {
    budget: {
      window: GatewayBudgetWindow;
      cycleAnchorAt: Instant | null;
      timezone: string | null;
    };
    now?: Instant;
  }): Instant {
    if (budget.cycleAnchorAt && GatewayWindow.isCyclicWindow(budget.window)) {
      return GatewayWindow.nextAnchoredResetAt({
        window: budget.window,
        anchorAt: budget.cycleAnchorAt,
        now,
      });
    }
    return GatewayWindow.nextResetAt(budget.window, now, budget.timezone);
  }

  static shouldResetBudget(
    window: GatewayBudgetWindow,
    resetsAt: Instant | string,
    now: Instant = nowInstant(),
  ): boolean {
    if (window === "TOTAL" || window === "MANUAL") return false;
    const resetMs = typeof resetsAt === "string" ? toEpochMs(resetsAt) : resetsAt.epochMilliseconds;
    return now.epochMilliseconds >= resetMs;
  }
}

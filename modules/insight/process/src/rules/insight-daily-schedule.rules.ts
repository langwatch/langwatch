/**
 * When a daily schedule runs: once per calendar date in its own time zone, at its hour and at a
 * minute fixed by its id, so "around 09:00" spreads one hour's schedules over that hour.
 * @see modules/insight/adrs/004-daily-run.md
 */

import { createHash } from "node:crypto";

import { nextCronFireAt, Temporal } from "@langwatch/time";

/** A slot handled later than this is missed: the schedule waits for the next day. */
export const MISSED_SLOT_GRACE_MS = 6 * 60 * 60_000;

/** The schedule's own minute of its hour: the same every day, and spread across schedules. */
export function dailyScheduleMinute({ scheduleId }: { scheduleId: string }): number {
  return createHash("sha256").update(scheduleId).digest().readUInt32BE(0) % 60;
}

function localDateOf({ instant, timezone }: { instant: number; timezone: string }): string {
  return Temporal.Instant.fromEpochMilliseconds(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}

/** Whether the slot falls on the calendar date the schedule's last run was for. */
function isOnLastRunDate({
  slot,
  lastSlot,
  timezone,
}: {
  slot: number;
  lastSlot: number | null;
  timezone: string;
}): boolean {
  return (
    lastSlot !== null &&
    localDateOf({ instant: slot, timezone }) === localDateOf({ instant: lastSlot, timezone })
  );
}

/**
 * The schedule's next slot strictly after `after`, never on the date its last run was for. The
 * cron reads the zone's wall clock: an hour the clock skips runs at the next valid time, and
 * an hour it repeats names one slot.
 */
export function nextDailySlot({
  scheduleId,
  hour,
  timezone,
  after,
  lastSlot,
}: {
  scheduleId: string;
  hour: number;
  timezone: string;
  after: number;
  lastSlot: number | null;
}): number {
  const cron = `${dailyScheduleMinute({ scheduleId })} ${hour} * * *`;
  const slotAfter = (instant: number) =>
    nextCronFireAt({ cron, timezone, after: Temporal.Instant.fromEpochMilliseconds(instant) })
      .epochMilliseconds;
  let slot = slotAfter(after);
  while (isOnLastRunDate({ slot, lastSlot, timezone })) slot = slotAfter(slot);
  return slot;
}

/**
 * Whether a wake for `slot`, handled at `now`, still runs: not when the schedule already ran for
 * that date, and not when the fleet was down long enough for the slot to be missed.
 */
export function isDueSlot({
  slot,
  now,
  lastSlot,
  timezone,
}: {
  slot: number;
  now: number;
  lastSlot: number | null;
  timezone: string;
}): boolean {
  return now - slot < MISSED_SLOT_GRACE_MS && !isOnLastRunDate({ slot, lastSlot, timezone });
}

/**
 * @vitest-environment node
 * When a daily schedule runs, at fixed instants: its own minute, one slot per calendar date in
 * its zone, and what the cron helper really answers on the two days the clocks change.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  dailyScheduleMinute,
  isDueSlot,
  MISSED_SLOT_GRACE_MS,
  nextDailySlot,
} from "../insight-daily-schedule.rules.ts";

/** Clocks go forward on 2026-03-29 (02:00 to 03:00) and back on 2026-10-25 (03:00 to 02:00). */
const ZONE = "Europe/Amsterdam";
const SCHEDULE = "insightschedule_a";
const MINUTE = dailyScheduleMinute({ scheduleId: SCHEDULE });
const MM = String(MINUTE).padStart(2, "0");
const MINUTE_MS = 60_000;

const at = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;
const iso = (instant: number) => Temporal.Instant.fromEpochMilliseconds(instant).toString();
const localOf = (instant: number) =>
  Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(ZONE).toPlainDateTime();

function next({
  hour,
  after,
  lastSlot = null,
}: {
  hour: number;
  after: string | number;
  lastSlot?: number | null;
}): number {
  return nextDailySlot({
    scheduleId: SCHEDULE,
    hour,
    timezone: ZONE,
    after: typeof after === "string" ? at(after) : after,
    lastSlot,
  });
}

/** Every slot from `from` on, one after the other, as the wake arms them. */
function slotsFrom({ hour, from, count }: { hour: number; from: string; count: number }) {
  const slots: number[] = [];
  let after = at(from);
  for (let taken = 0; taken < count; taken++) {
    after = next({ hour, after });
    slots.push(after);
  }
  return slots;
}

describe("a schedule's minute", () => {
  /** @scenario "A schedule runs at its own minute, the same every day and spread across schedules" */
  it("is the same for the same schedule, within the hour, and spread across schedules", () => {
    const minutes = Array.from({ length: 600 }, (_, index) =>
      dailyScheduleMinute({ scheduleId: `insightschedule_${index}` }),
    );
    const perMinute = new Map<number, number>();
    for (const minute of minutes) perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);

    expect(dailyScheduleMinute({ scheduleId: SCHEDULE })).toBe(MINUTE);
    expect(minutes.every((minute) => Number.isInteger(minute) && minute >= 0 && minute < 60)).toBe(
      true,
    );
    // 600 schedules over 60 minutes: every minute is used, and none holds three times its share.
    expect(perMinute.size).toBe(60);
    expect(Math.max(...perMinute.values())).toBeLessThan(30);
  });

  it("is the minute of the slot on two days in a row", () => {
    const [first, second] = slotsFrom({ hour: 9, from: "2026-06-01T00:00:00Z", count: 2 });

    expect(iso(first!)).toBe(`2026-06-01T07:${MM}:00Z`);
    expect(second! - first!).toBe(24 * 60 * MINUTE_MS);
    expect([localOf(first!).minute, localOf(second!).minute]).toEqual([MINUTE, MINUTE]);
  });
});

describe("the next slot", () => {
  it("is strictly after the instant asked from", () => {
    const slot = at(`2026-06-01T07:${MM}:00Z`);

    expect(next({ hour: 9, after: slot - 1 })).toBe(slot);
    expect(next({ hour: 9, after: slot })).toBe(slot + 24 * 60 * MINUTE_MS);
  });

  /** @scenario "A schedule that already ran for a date waits for the next date" */
  it("skips the date the last run was for", () => {
    const ranAt = at("2026-06-01T05:10:00Z");

    const slot = next({ hour: 9, after: "2026-06-01T06:00:00Z", lastSlot: ranAt });

    expect(iso(slot)).toBe(`2026-06-02T07:${MM}:00Z`);
  });

  describe("when the clocks go forward that day", () => {
    /** @scenario "A schedule runs once on each day the clocks change" */
    it("names one slot per calendar date at its hour, an hour of universal time earlier", () => {
      const slots = slotsFrom({ hour: 9, from: "2026-03-27T12:00:00Z", count: 3 });

      expect(slots.map(iso)).toEqual([
        `2026-03-28T08:${MM}:00Z`,
        `2026-03-29T07:${MM}:00Z`,
        `2026-03-30T07:${MM}:00Z`,
      ]);
      expect(slots.map((slot) => localOf(slot).toString().slice(0, 16))).toEqual([
        `2026-03-28T09:${MM}`,
        `2026-03-29T09:${MM}`,
        `2026-03-30T09:${MM}`,
      ]);
    });

    /** @scenario "An hour the clocks skip runs at the next valid time that day" */
    it("runs a schedule for the skipped hour an hour later on the wall clock, once", () => {
      const slots = slotsFrom({ hour: 2, from: "2026-03-27T12:00:00Z", count: 3 });

      expect(slots.map(iso)).toEqual([
        `2026-03-28T01:${MM}:00Z`,
        `2026-03-29T01:${MM}:00Z`,
        `2026-03-30T00:${MM}:00Z`,
      ]);
      // 02:mm does not exist on the 29th: the slot reads 03:mm there, and 02:mm the day after.
      expect(slots.map((slot) => localOf(slot).toString().slice(0, 16))).toEqual([
        `2026-03-28T02:${MM}`,
        `2026-03-29T03:${MM}`,
        `2026-03-30T02:${MM}`,
      ]);
    });
  });

  describe("when the clocks go back that day", () => {
    /** @scenario "A schedule runs once on each day the clocks change" */
    it("names one slot per calendar date at its hour, an hour of universal time later", () => {
      const slots = slotsFrom({ hour: 9, from: "2026-10-23T12:00:00Z", count: 3 });

      expect(slots.map(iso)).toEqual([
        `2026-10-24T07:${MM}:00Z`,
        `2026-10-25T08:${MM}:00Z`,
        `2026-10-26T08:${MM}:00Z`,
      ]);
    });

    /** @scenario "An hour the clocks repeat runs once" */
    it("names the first of the two 02:mm and no slot for the second", () => {
      const first = at(`2026-10-25T00:${MM}:00Z`);
      const second = first + 60 * MINUTE_MS;

      expect(localOf(first).toString()).toBe(localOf(second).toString());
      expect(next({ hour: 2, after: "2026-10-24T12:00:00Z" })).toBe(first);
      expect(iso(next({ hour: 2, after: first }))).toBe(`2026-10-26T01:${MM}:00Z`);
      // Asked between the two, the wall clock has passed 02:mm already: the next is tomorrow's.
      expect(iso(next({ hour: 2, after: first + MINUTE_MS }))).toBe(`2026-10-26T01:${MM}:00Z`);
    });

    it("refuses a wake for the second 02:mm once the first ran", () => {
      const first = at(`2026-10-25T00:${MM}:00Z`);
      const second = first + 60 * MINUTE_MS;

      expect(isDueSlot({ slot: second, now: second, lastSlot: first, timezone: ZONE })).toBe(false);
      expect(isDueSlot({ slot: second, now: second, lastSlot: null, timezone: ZONE })).toBe(true);
    });
  });
});

describe("a wake's slot", () => {
  const slot = at(`2026-06-01T07:${MM}:00Z`);
  const due = (now: number) => isDueSlot({ slot, now, lastSlot: null, timezone: ZONE });

  /** @scenario "A slot missed by less than six hours still runs" */
  it("is due on time and 5 hours 59 minutes late", () => {
    expect(due(slot)).toBe(true);
    expect(due(slot + MISSED_SLOT_GRACE_MS - MINUTE_MS)).toBe(true);
  });

  /** @scenario "A slot missed by six hours or more waits for the next day" */
  it("is missed 6 hours late and 6 hours 1 minute late", () => {
    expect(MISSED_SLOT_GRACE_MS).toBe(6 * 60 * MINUTE_MS);
    expect(due(slot + MISSED_SLOT_GRACE_MS)).toBe(false);
    expect(due(slot + MISSED_SLOT_GRACE_MS + MINUTE_MS)).toBe(false);
  });
});

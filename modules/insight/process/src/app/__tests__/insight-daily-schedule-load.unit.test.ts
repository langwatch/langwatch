/**
 * @vitest-environment node
 * A thousand schedules for the same hour on the memory worker, at a clock the test moves a
 * minute at a time: the installed module, its real pipeline and each schedule's own wake.
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BOARD, installDailyRuns, type InstalledDailyRuns } from "./insight-daily-run.fixture.ts";
import { DAY_MS, onFirstDay } from "./insight-daily-schedule.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

const SCHEDULES = 1_000;
const MINUTE_MS = 60_000;
const HOUR_START = onFirstDay("09:00");
/** A thousand over sixty minutes is 17 a minute; a minute with 40 is a crowd. */
const CROWD = 40;
/** About four seconds of work on a laptop; the room is for a busy runner. */
const TIMEOUT_MS = 30_000;

const people = Array.from({ length: SCHEDULES }, (_, at) => `user-load-${at}`);

let installed: InstalledDailyRuns;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(onFirstDay("07:00"));
  installed = await installDailyRuns();
});

afterEach(async () => {
  vi.useRealTimers();
  await installed.stop();
});

async function turnOnForEveryone(): Promise<void> {
  for (const userId of people) {
    await installed.app.configureDailyRun({
      projectId: PROJECT,
      userId,
      board: BOARD,
      hour: 9,
      timezone: "UTC",
      maxInsights: 3,
    });
  }
}

type Started = { scheduleId: string; runId: string; slot: number };

/** Every run each person's schedule handed the outbox so far. */
async function startedRuns(): Promise<Started[]> {
  const perPerson = await Promise.all(people.map((userId) => installed.intentsOf({ userId })));
  return perPerson.flat().map(({ payload }) => payload as Started);
}

/**
 * Moves the clock through an hour a minute at a time and handles every wake due at the end of
 * each minute, as the wake worker does. Answers how many wakes each minute handled.
 */
async function passHour({ from }: { from: number }): Promise<number[]> {
  const perMinute: number[] = [];
  for (let minute = 0; minute < 60; minute += 1) {
    const now = from + minute * MINUTE_MS + MINUTE_MS - 1;
    vi.setSystemTime(now);
    perMinute.push(await installed.wakeDue({ now, limit: SCHEDULES }));
  }
  return perMinute;
}

const minuteOf = (slot: number) => Math.floor((slot - HOUR_START) / MINUTE_MS);

describe("given 1,000 people turned their daily run on for the same hour", () => {
  describe("when the hour passes, a minute at a time", () => {
    /** @scenario "A thousand schedules due inside one hour each run once, spread over the hour" */
    it(
      "starts each schedule's run once, in its own minute, with no minute crowded",
      async () => {
        await turnOnForEveryone();

        const perMinute = await passHour({ from: HOUR_START });
        const runs = await startedRuns();
        const again = await passHour({ from: HOUR_START });
        const [first = ""] = people;
        const instance = await installed.instanceOf({ userId: first });

        const startedIn = Array.from({ length: 60 }, () => 0);
        for (const { slot } of runs)
          startedIn[minuteOf(slot)] = (startedIn[minuteOf(slot)] ?? 0) + 1;
        // One run for each schedule, named by a slot inside the hour.
        expect(runs).toHaveLength(SCHEDULES);
        expect(new Set(runs.map(({ scheduleId }) => scheduleId)).size).toBe(SCHEDULES);
        expect(runs.every(({ slot, runId }) => runId === `slot:${slot}`)).toBe(true);
        expect(runs.every(({ slot }) => minuteOf(slot) >= 0 && minuteOf(slot) < 60)).toBe(true);
        // Each run started in its slot's own minute, and the hour's runs are spread over it.
        expect(perMinute).toEqual(startedIn);
        expect(Math.min(...perMinute)).toBeGreaterThan(0);
        expect(Math.max(...perMinute)).toBeLessThan(CROWD);
        // Nothing is due again in the hour: each schedule's next wake is the day after its slot.
        expect(again).toEqual(Array.from({ length: 60 }, () => 0));
        expect(await startedRuns()).toHaveLength(SCHEDULES);
        expect(instance?.nextWakeAt).toBe((instance?.state.lastSlot ?? 0) + DAY_MS);
      },
      TIMEOUT_MS,
    );
  });
});

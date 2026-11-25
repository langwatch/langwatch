/**
 * A schedule driven a day at a time over the installed module: turn it on, move the clock to a
 * day's slot, handle the wake and carry its run out. The caller fakes the clock and sets it
 * before the first slot of {@link FIRST_DAY}.
 */

import type { InsightRunBoard } from "@langwatch/insight-contract";
import { Temporal } from "@langwatch/time";
import { vi } from "vitest";

import { dailyScheduleMinute } from "../../rules/insight-daily-schedule.rules.ts";
import { BOARD, type InstalledDailyRuns, MEMBER } from "./insight-daily-run.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

export const FIRST_DAY = "2026-10-10";
export const DAY_MS = 24 * 60 * 60_000;

/** An instant of the first day, in UTC. */
export const onFirstDay = (clock: string) =>
  Temporal.Instant.from(`${FIRST_DAY}T${clock}:00Z`).epochMilliseconds;

type Scope = { userId?: string; board?: InsightRunBoard };

export function scheduleDriver(installed: InstalledDailyRuns) {
  /** The schedule's 09:mm slot, in UTC, on a day counted from the first. */
  const slotOf = ({ day = 0, ...scope }: Scope & { day?: number } = {}) => {
    const minute = dailyScheduleMinute({ scheduleId: installed.scheduleIdOf(scope) });
    return onFirstDay(`09:${String(minute).padStart(2, "0")}`) + day * DAY_MS;
  };
  const settingOf = ({ userId = MEMBER, board = BOARD }: Scope = {}) =>
    installed.app.getDailyRunSetting({ projectId: PROJECT, userId, board });

  return {
    slotOf,
    settingOf,
    turnOn: ({ userId = MEMBER, board = BOARD }: Scope = {}) =>
      installed.app.configureDailyRun({
        projectId: PROJECT,
        userId,
        board,
        hour: 9,
        timezone: "UTC",
        maxInsights: 3,
      }),
    /** Handles the day's wake and carries out the run it started; answers that run, if any. */
    runDay: async ({ day, ...scope }: Scope & { day: number }) => {
      const now = slotOf({ day, ...scope }) + 2_000;
      vi.setSystemTime(now);
      const before = (await installed.intentsOf(scope)).length;
      await installed.wakeDue({ now });
      const [started] = (await installed.intentsOf(scope)).slice(before);
      if (started) await installed.carryOut(started.payload);
      return started?.payload;
    },
    /** How many skipped days the schedule's process and its row each count. */
    skippedDaysOf: async (scope: Scope = {}) => {
      const scheduleId = installed.scheduleIdOf(scope);
      const [listed] = (await installed.app.findOperatorDailySchedules({ limit: 500 })).filter(
        (schedule) => schedule.scheduleId === scheduleId,
      );
      const instance = await installed.instanceOf(scope);
      return { process: instance?.state.skipStreak.count, row: listed?.consecutiveSkips };
    },
  };
}

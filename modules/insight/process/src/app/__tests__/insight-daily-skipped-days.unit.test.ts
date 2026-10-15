/**
 * @vitest-environment node
 * A schedule nobody can run for, and a project with nothing new, over the memory worker: the
 * read before Langy, the skipped days as they add up, and the day the schedule turns itself off.
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import { INSIGHT_DAILY_RUN_EVENT_TYPES } from "@langwatch/insight-contract";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dailyRunWindows } from "../../rules/insight-daily-run.rules.ts";
import {
  INSIGHT_DAILY_RUN_DURATION_METRIC_NAME as DURATION,
  INSIGHT_DAILY_RUN_TOTAL_METRIC_NAME as RUNS,
} from "../../services/insight-daily-run-metrics.service.ts";
import {
  answerWith,
  finding,
  installDailyRuns,
  type InstalledDailyRuns,
  MEMBER,
} from "./insight-daily-run.fixture.ts";
import { onFirstDay, scheduleDriver } from "./insight-daily-schedule.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

const { TURNED_OFF } = INSIGHT_DAILY_RUN_EVENT_TYPES;

let installed: InstalledDailyRuns;
let schedule: ReturnType<typeof scheduleDriver>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(onFirstDay("07:00"));
  installed = await installDailyRuns();
  installed.world.langy.answer = answerWith([finding()]);
  schedule = scheduleDriver(installed);
  await schedule.turnOn();
});

afterEach(async () => {
  vi.useRealTimers();
  await installed.stop();
});

const offsOf = async () =>
  (await installed.runEventsOf()).filter((type) => type === TURNED_OFF).length;

/** Runs the schedule on each day named, with whatever access and traces the world holds. */
async function runDays({ from, to }: { from: number; to: number }) {
  for (let day = from; day <= to; day += 1) await schedule.runDay({ day });
}

describe("given a member with analytics:view and a board with widgets", () => {
  describe("when the project took no trace since the run's window began", () => {
    beforeEach(() => {
      installed.world.hasNewTraces = false;
    });

    /** @scenario "A run on a project with no new traces asks Langy nothing" */
    it("records nothing with no_new_traces, asks Langy nothing and files nothing", async () => {
      const slot = schedule.slotOf();

      await schedule.runDay({ day: 0 });

      expect(await installed.outcomesOf()).toEqual([
        { runId: `slot:${slot}`, outcome: "nothing", reason: "no_new_traces" },
      ]);
      expect(installed.langy.starts).toEqual([]);
      expect(await installed.app.findInsights({ projectId: PROJECT, userId: MEMBER })).toEqual([]);
      expect(installed.lwql.traceAsks).toEqual([
        {
          projectId: PROJECT,
          source: "trace",
          since: dailyRunWindows({ slot, timezone: "UTC" }).window.start,
          excludeOrigins: ["langy"],
        },
      ]);
      expect((await schedule.settingOf()).lastRun).toMatchObject({
        outcome: "nothing",
        reason: "no_new_traces",
        filedCount: 0,
        conversationId: null,
      });
    });

    it("keeps the schedule on and arms the next day", async () => {
      await schedule.runDay({ day: 0 });

      expect(await schedule.settingOf()).toMatchObject({ state: "on", offReason: null });
      expect((await installed.instanceOf())?.nextWakeAt).toBe(schedule.slotOf({ day: 1 }));
    });

    /** @scenario "A daily run records its metrics as it settles" */
    it("counts one run as nothing with no_new_traces, with a duration", async () => {
      const metrics = createRecordingMeterProvider();
      metrics.install();

      await schedule.runDay({ day: 0 });
      const counted = metrics.recorded.filter(({ instrument }) => instrument === RUNS);
      const durations = metrics.valuesOf(DURATION, { outcome: "nothing" });
      metrics.uninstall();

      expect(counted).toEqual([
        { instrument: RUNS, value: 1, attributes: { outcome: "nothing", reason: "no_new_traces" } },
      ]);
      expect(durations).toHaveLength(1);
    });
  });

  describe("when the project's only new traces are Langy's own turns", () => {
    beforeEach(() => {
      installed.world.newTraceOrigins = ["langy"];
    });

    /** @scenario "A project whose only new traces are Langy's own asks Langy nothing" */
    it("records nothing with no_new_traces and asks Langy nothing", async () => {
      await schedule.runDay({ day: 0 });

      expect(installed.langy.starts).toEqual([]);
      expect((await schedule.settingOf()).lastRun).toMatchObject({
        outcome: "nothing",
        reason: "no_new_traces",
      });
    });
  });

  describe("when the project took a trace", () => {
    it("asks once, then asks Langy and files what it found", async () => {
      await schedule.runDay({ day: 0 });

      expect(installed.lwql.traceAsks).toHaveLength(1);
      expect(installed.langy.starts).toHaveLength(1);
      expect((await schedule.settingOf()).lastRun).toMatchObject({ outcome: "filed" });
    });
  });
});

describe("given a member without analytics:view on a project that took no trace", () => {
  beforeEach(() => {
    installed.world.readers.delete(MEMBER);
    installed.world.hasNewTraces = false;
  });

  /** @scenario "A member without access is skipped before the project's traces are asked" */
  it("records skipped with no_access and never asks for the project's traces", async () => {
    await schedule.runDay({ day: 0 });

    expect((await schedule.settingOf()).lastRun).toMatchObject({
      outcome: "skipped",
      reason: "no_access",
    });
    expect(installed.lwql.traceAsks).toEqual([]);
  });
});

describe("given a member who lost analytics:view, with their daily run on for a board", () => {
  beforeEach(() => {
    installed.world.readers.delete(MEMBER);
  });

  describe("when the run is skipped on 7 scheduled days in a row", () => {
    /** @scenario "The seventh skipped day turns the schedule off" */
    it("stays on through the sixth day and is turned off by the system on the seventh", async () => {
      await runDays({ from: 0, to: 5 });
      const afterSix = await schedule.settingOf();
      const armedAfterSix = (await installed.instanceOf())?.nextWakeAt;
      const offsAfterSix = await offsOf();

      await schedule.runDay({ day: 6 });

      expect(afterSix).toMatchObject({ state: "on", offReason: null });
      expect(armedAfterSix).toBe(schedule.slotOf({ day: 6 }));
      expect(offsAfterSix).toBe(0);
      expect(await offsOf()).toBe(1);
      expect(await schedule.settingOf()).toMatchObject({
        state: "off",
        offReason: "skipped_days",
        settings: { hour: 9, timezone: "UTC", maxInsights: 3 },
        lastRun: { outcome: "skipped", reason: "no_access" },
      });
      expect((await installed.instanceOf())?.nextWakeAt).toBeNull();
      expect(await schedule.runDay({ day: 7 })).toBeUndefined();
      expect(installed.langy.starts).toEqual([]);
    });

    it("counts the same days in the schedule's process and on its row", async () => {
      await runDays({ from: 0, to: 3 });

      expect(await schedule.skippedDaysOf()).toEqual({ process: 4, row: 4 });
    });
  });

  describe("when the next day's run ends as nothing with the reason no_new_traces", () => {
    /** @scenario "A day with no new traces is no skipped day" */
    it("starts the count over and stays on", async () => {
      await runDays({ from: 0, to: 5 });
      installed.world.readers.add(MEMBER);
      installed.world.hasNewTraces = false;

      await schedule.runDay({ day: 6 });

      expect((await schedule.settingOf()).lastRun).toMatchObject({
        outcome: "nothing",
        reason: "no_new_traces",
      });
      expect(await schedule.skippedDaysOf()).toEqual({ process: 0, row: 0 });
      expect(await schedule.settingOf()).toMatchObject({ state: "on", offReason: null });
      expect(await offsOf()).toBe(0);
    });
  });

  describe("when the member has access again and the next day's run files", () => {
    /** @scenario "A run that files between skipped days starts the count over" */
    it("starts the count over, and 6 more skipped days leave the schedule on", async () => {
      await runDays({ from: 0, to: 5 });
      installed.world.readers.add(MEMBER);
      await schedule.runDay({ day: 6 });
      const afterFiling = await schedule.skippedDaysOf();
      installed.world.readers.delete(MEMBER);

      await runDays({ from: 7, to: 12 });

      expect(afterFiling).toEqual({ process: 0, row: 0 });
      expect(await schedule.skippedDaysOf()).toEqual({ process: 6, row: 6 });
      expect(await schedule.settingOf()).toMatchObject({ state: "on", offReason: null });
      expect(await offsOf()).toBe(0);
    });
  });

  describe("when the person turns it on again after the system turned it off", () => {
    /** @scenario "Turning the daily run on again starts the count over" */
    it("stays on after the next skipped run, with no reason", async () => {
      await runDays({ from: 0, to: 6 });
      const off = await schedule.settingOf();
      await schedule.turnOn();

      await schedule.runDay({ day: 7 });

      expect(off).toMatchObject({ state: "off", offReason: "skipped_days" });
      expect(await schedule.settingOf()).toMatchObject({
        state: "on",
        offReason: null,
        lastRun: { outcome: "skipped", reason: "no_access" },
      });
      expect(await schedule.skippedDaysOf()).toEqual({ process: 1, row: 1 });
      expect(await offsOf()).toBe(1);
    });
  });
});

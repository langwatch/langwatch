/**
 * @vitest-environment node
 * The operator's list over the memory worker: every person's schedule in the project, read
 * from the rows the pipeline folded and the wakes its process armed.
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import type { InsightRunBoard } from "@langwatch/insight-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerWith,
  BOARD,
  finding,
  installDailyRuns,
  type InstalledDailyRuns,
  MEMBER,
  OTHER_MEMBER,
} from "./insight-daily-run.fixture.ts";
import { onFirstDay, scheduleDriver } from "./insight-daily-schedule.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

const TEMPLATE: InsightRunBoard = { kind: "template", id: "release", name: "Release check" };
const SETTINGS = { hour: 9, timezone: "UTC", maxInsights: 3 };
const THIRD = "user-third";

let installed: InstalledDailyRuns;
let schedule: ReturnType<typeof scheduleDriver>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(onFirstDay("07:00"));
  installed = await installDailyRuns();
  installed.world.langy.answer = answerWith([finding()]);
  schedule = scheduleDriver(installed);
});

afterEach(async () => {
  vi.useRealTimers();
  await installed.stop();
});

const listed = (limit = 200) => installed.app.findOperatorDailySchedules({ limit });
const turnOff = (scope: { userId?: string; board?: InsightRunBoard } = {}) =>
  installed.app.turnOffDailyRun({
    projectId: PROJECT,
    userId: scope.userId ?? MEMBER,
    board: scope.board ?? BOARD,
  });

describe("given schedules that are on and off for two people, and a board a third never decided on", () => {
  beforeEach(async () => {
    await schedule.turnOn();
    await schedule.runDay({ day: 0 });
    await schedule.turnOn({ userId: OTHER_MEMBER });
    await turnOff({ userId: OTHER_MEMBER });
    await schedule.turnOn({ board: TEMPLATE });
    // An operator's run on a board its person never decided on leaves a row, and no schedule.
    await installed.app.requestDailyRun({ projectId: PROJECT, userId: THIRD, board: BOARD });
    const [requested] = await installed.intentsOf({ userId: THIRD });
    await installed.carryOut(requested?.payload);
  });

  describe("when the operator's list is read", () => {
    /** @scenario "The operator's list reads every project's schedules, the ones that are on first" */
    it("holds the ones that are on, then the ones that are off, and never the undecided one", async () => {
      const on = [installed.scheduleIdOf(), installed.scheduleIdOf({ board: TEMPLATE })];
      const undecided = await installed.app.findDailyRuns({ projectId: PROJECT, userId: THIRD });

      const schedules = await listed();

      expect(schedules.map(({ state, scheduleId }) => [state, scheduleId])).toEqual([
        ...on.toSorted().map((scheduleId) => ["on", scheduleId]),
        ["off", installed.scheduleIdOf({ userId: OTHER_MEMBER })],
      ]);
      expect(undecided).toMatchObject([{ lastRun: { outcome: "skipped" } }]);
    });

    it("names each one's project, person, board, setting and how its last run ended", async () => {
      const mine = (await listed()).find(
        ({ scheduleId }) => scheduleId === installed.scheduleIdOf(),
      );

      expect(mine).toEqual({
        scheduleId: installed.scheduleIdOf(),
        projectId: PROJECT,
        userId: MEMBER,
        board: BOARD,
        state: "on",
        offReason: null,
        settings: SETTINGS,
        nextRunAt: schedule.slotOf({ day: 1 }),
        lastRun: {
          at: schedule.slotOf() + 2_000,
          outcome: "filed",
          reason: null,
          filedCount: 1,
          renewedCount: 0,
          conversationId: "conversation-1",
        },
        consecutiveSkips: 0,
      });
    });

    it("lists no more than the limit, and takes a limit of none as one", async () => {
      expect(await listed(2)).toHaveLength(2);
      expect(await listed(0)).toHaveLength(1);
    });
  });
});

describe("given a schedule a clean-up turned off, and one that is on with 2 skipped days", () => {
  beforeEach(async () => {
    installed.world.readers.delete(OTHER_MEMBER);
    await schedule.turnOn({ userId: OTHER_MEMBER });
    await schedule.runDay({ day: 0, userId: OTHER_MEMBER });
    await schedule.runDay({ day: 1, userId: OTHER_MEMBER });
    await schedule.turnOn();
    await installed.memberRemoved({ userId: MEMBER, occurredAt: Date.now(), id: "fact-left" });
    await vi.waitFor(async () => {
      if ((await schedule.settingOf()).state !== "off") throw new Error("still on");
    });
  });

  describe("when the operator's list is read", () => {
    /** @scenario "The operator's list says why a schedule is off, its skipped days and its next run" */
    it("reads the first off with its reason, and the second on with its count and its slot", async () => {
      const [on, off] = await listed();

      expect(on).toMatchObject({
        userId: OTHER_MEMBER,
        state: "on",
        offReason: null,
        consecutiveSkips: 2,
        nextRunAt: schedule.slotOf({ day: 2, userId: OTHER_MEMBER }),
        lastRun: { outcome: "skipped", reason: "no_access" },
      });
      expect(off).toMatchObject({
        userId: MEMBER,
        state: "off",
        offReason: "member_removed",
        consecutiveSkips: 0,
        nextRunAt: null,
        lastRun: null,
      });
    });
  });
});

describe("given a schedule that is on and whose wake was lost", () => {
  beforeEach(async () => {
    await schedule.turnOn();
    await installed.loseWake();
  });

  /** @scenario "A schedule that lost its wake reads on with no next run" */
  it("reads on with no next run", async () => {
    expect(await listed()).toMatchObject([{ state: "on", nextRunAt: null }]);
  });
});

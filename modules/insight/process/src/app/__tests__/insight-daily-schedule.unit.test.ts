/**
 * @vitest-environment node
 * A schedule over the memory process store: the installed module, its real pipeline and the
 * process's own wake, at a clock the test moves. The wake is handled the way the wake worker
 * handles it, and its run is carried out the way the outbox carries it out.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_RUN_PIPELINE_NAME,
  type InsightRunBoard,
} from "@langwatch/insight-contract";
import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INSIGHT_SCHEDULE_RECONCILE_INTENT } from "../../eventing/insight-daily-schedule-reconcile.intent.ts";
import {
  INSIGHT_SCHEDULE_RECONCILE_INTERVAL_MS,
  insightScheduleReconcileWake,
} from "../../eventing/insight-daily-schedule-reconcile.process.ts";
import { dailyScheduleMinute } from "../../rules/insight-daily-schedule.rules.ts";
import {
  answerWith,
  BOARD,
  finding,
  installDailyRuns,
  type InstalledDailyRuns,
  MEMBER,
  OTHER_MEMBER,
} from "./insight-daily-run.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

const { CONFIGURED, TURNED_OFF, REARM_REQUESTED, RUN_STARTED, RUN_SETTLED } =
  INSIGHT_DAILY_RUN_EVENT_TYPES;
const TEMPLATE: InsightRunBoard = { kind: "template", id: "llm-costs", name: "LLM costs" };
const TWO_FINDINGS = answerWith([
  finding(),
  finding({ title: "Errors fell by half", tone: "good" }),
]);
const TODAY = "2026-10-10";
const TOMORROW = "2026-10-11";

const at = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;

let installed: InstalledDailyRuns;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(`${TODAY}T07:00:00Z`));
  installed = await installDailyRuns();
  installed.world.langy.answer = TWO_FINDINGS;
});

afterEach(async () => {
  vi.useRealTimers();
  await installed.stop();
});

type Scope = { userId?: string; board?: InsightRunBoard };

/** The schedule's slot on a date at an hour, in UTC: its hour and its own minute. */
function slotOn({ date, hour = 9, ...scope }: { date: string; hour?: number } & Scope) {
  const minute = dailyScheduleMinute({ scheduleId: installed.scheduleIdOf(scope) });
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return at(`${date}T${clock}:00Z`);
}

const turnOn = ({ userId = MEMBER, board = BOARD, hour = 9 }: Scope & { hour?: number } = {}) =>
  installed.app.configureDailyRun({
    projectId: PROJECT,
    userId,
    board,
    hour,
    timezone: "UTC",
    maxInsights: 3,
  });

const settingOf = ({ userId = MEMBER, board = BOARD }: Scope = {}) =>
  installed.app.getDailyRunSetting({ projectId: PROJECT, userId, board });

/** Moves the clock to `now`, handles the wakes due then and answers the runs they started. */
async function wakeAt(now: number, scope: Scope = {}) {
  vi.setSystemTime(now);
  const before = (await installed.intentsOf(scope)).length;
  await installed.wakeDue({ now });
  return (await installed.intentsOf(scope)).slice(before).map(({ payload }) => payload);
}

describe("given a member turned their daily run on for a board", () => {
  beforeEach(async () => {
    await turnOn();
  });

  /** @scenario "A daily run that is on wakes, runs, settles and arms the next day" */
  it("arms the slot, runs once at it, files for the member and arms the next day", async () => {
    const slot = slotOn({ date: TODAY });
    const armed = await installed.instanceOf();

    const [run, ...others] = await wakeAt(slot + 2_000);
    const waiting = await installed.instanceOf();
    await installed.carryOut(run);
    const settledInstance = await installed.instanceOf();

    expect(armed?.nextWakeAt).toBe(slot);
    expect(others).toEqual([]);
    expect(run).toMatchObject({ userId: MEMBER, board: BOARD, maxInsights: 3, slot });
    expect(waiting?.state.pendingRun).toMatchObject({ runId: `slot:${slot}`, slot });
    expect(settledInstance?.state.pendingRun).toBeNull();
    expect(settledInstance?.nextWakeAt).toBe(slotOn({ date: TOMORROW }));
    expect(await installed.runEventsOf()).toEqual([CONFIGURED, RUN_STARTED, RUN_SETTLED]);
    expect(await installed.app.findInsights({ projectId: PROJECT, userId: MEMBER })).toHaveLength(
      2,
    );
    expect(await settingOf()).toEqual({
      state: "on",
      settings: { hour: 9, timezone: "UTC", maxInsights: 3 },
      lastRun: {
        at: slot + 2_000,
        outcome: "filed",
        reason: null,
        filedCount: 2,
        conversationId: "conversation-1",
      },
    });
  });

  it("starts no run before the slot, and none for another member", async () => {
    const early = await wakeAt(slotOn({ date: TODAY }) - 1);

    expect(early).toEqual([]);
    expect(await installed.intentsOf({ userId: OTHER_MEMBER })).toEqual([]);
    expect(await settingOf({ userId: OTHER_MEMBER })).toEqual({
      state: "undecided",
      settings: null,
      lastRun: null,
    });
  });

  describe("when they turn it off before the slot", () => {
    /** @scenario "Turning the daily run off cancels its wake" */
    it("disarms the wake, starts no run at the slot and keeps what they chose", async () => {
      await installed.app.turnOffDailyRun({ projectId: PROJECT, userId: MEMBER, board: BOARD });
      const instance = await installed.instanceOf();

      const runs = await wakeAt(slotOn({ date: TODAY }) + 2_000);

      expect(instance?.nextWakeAt).toBeNull();
      expect(runs).toEqual([]);
      expect(installed.langy.starts).toEqual([]);
      expect(await installed.runEventsOf()).toEqual([CONFIGURED, TURNED_OFF]);
      expect(await settingOf()).toEqual({
        state: "off",
        settings: { hour: 9, timezone: "UTC", maxInsights: 3 },
        lastRun: null,
      });
    });
  });

  describe("when a run never records an outcome", () => {
    /** @scenario "A superseded run is recorded as failed with the reason timeout" */
    it("records it as failed with timeout before the next day's run, which then files", async () => {
      const first = slotOn({ date: TODAY });
      const second = slotOn({ date: TOMORROW });
      await wakeAt(first + 2_000);

      const [run] = await wakeAt(second + 2_000);
      await installed.carryOut(run);
      // The outbox may deliver the run twice: the lost run is recorded once.
      await installed.carryOut(run);

      expect(run).toMatchObject({
        runId: `slot:${second}`,
        supersedes: { runId: `slot:${first}`, slot: first },
      });
      expect(await installed.outcomesOf()).toEqual([
        { runId: `slot:${first}`, outcome: "failed", reason: "timeout" },
        { runId: `slot:${second}`, outcome: "filed", reason: null },
      ]);
      expect((await settingOf()).lastRun).toMatchObject({ outcome: "filed", filedCount: 2 });
      expect((await installed.instanceOf())?.state.pendingRun).toBeNull();
    });
  });

  describe("when the board is gone at the slot", () => {
    /** @scenario "A run that finds its board gone turns the daily run off" */
    it("records skipped with board_deleted, turns the schedule off and arms no wake", async () => {
      installed.world.boards.delete(BOARD.id);

      const [run] = await wakeAt(slotOn({ date: TODAY }) + 2_000);
      await installed.carryOut(run);

      expect(installed.langy.starts).toEqual([]);
      expect(await installed.runEventsOf()).toEqual([CONFIGURED, RUN_SETTLED, TURNED_OFF]);
      expect(await settingOf()).toMatchObject({
        state: "off",
        settings: { hour: 9, timezone: "UTC", maxInsights: 3 },
        lastRun: { outcome: "skipped", reason: "board_deleted" },
      });
      expect((await installed.instanceOf())?.nextWakeAt).toBeNull();
      expect(await wakeAt(slotOn({ date: TOMORROW }) + 2_000)).toEqual([]);
    });
  });

  describe("when the wake is lost", () => {
    /** @scenario "A schedule whose wake was lost is armed again with its own setting" */
    it("is armed again by the reconcile pass, with its setting unchanged", async () => {
      const passAt = at(`${TODAY}T08:00:00Z`);
      await installed.loseWake();
      const lost = await installed.instanceOf();

      vi.setSystemTime(passAt);
      await installed.reconcile({ passAt });

      expect(lost?.nextWakeAt).toBeNull();
      expect((await installed.instanceOf())?.nextWakeAt).toBe(slotOn({ date: TODAY }));
      expect(await installed.runEventsOf()).toEqual([CONFIGURED, REARM_REQUESTED]);
      expect(await settingOf()).toMatchObject({
        state: "on",
        settings: { hour: 9, timezone: "UTC", maxInsights: 3 },
      });
    });

    /** @scenario "A pass carried out twice asks each schedule once" */
    it("records one request when the same pass asks the schedule twice", async () => {
      const passAt = at(`${TODAY}T08:00:00Z`);
      const { requestScheduleRearm } = installed.eventing.getPipeline(
        INSIGHT_DAILY_RUN_PIPELINE_NAME,
      ).commands;
      const ask = () =>
        requestScheduleRearm?.send({
          tenantId: PROJECT,
          occurredAt: passAt,
          scheduleId: installed.scheduleIdOf(),
          userId: MEMBER,
          board: BOARD,
          hour: 9,
          timezone: "UTC",
          maxInsights: 3,
        });
      await installed.loseWake();

      await ask();
      await ask();

      expect(requestScheduleRearm).toBeDefined();
      expect(await installed.runEventsOf()).toEqual([CONFIGURED, REARM_REQUESTED]);
    });
  });

  describe("when a reconcile pass finds its wake armed", () => {
    /** @scenario "A pass leaves an armed schedule alone" */
    it("asks nothing of it", async () => {
      await installed.reconcile({ passAt: at(`${TODAY}T08:00:00Z`) });

      expect(await installed.runEventsOf()).toEqual([CONFIGURED]);
      expect((await installed.instanceOf())?.nextWakeAt).toBe(slotOn({ date: TODAY }));
    });
  });
});

describe("given a member turned their daily run on for a From LangWatch board", () => {
  /** @scenario "A From LangWatch board that is on is skipped each day and stays on" */
  it("records skipped with template_board, stays on and arms the next day", async () => {
    const scope = { board: TEMPLATE };
    await turnOn(scope);

    const [run] = await wakeAt(slotOn({ date: TODAY, ...scope }) + 2_000, scope);
    await installed.carryOut(run);

    expect(installed.langy.starts).toEqual([]);
    expect(await settingOf(scope)).toMatchObject({
      state: "on",
      lastRun: { outcome: "skipped", reason: "template_board" },
    });
    expect((await installed.instanceOf(scope))?.nextWakeAt).toBe(
      slotOn({ date: TOMORROW, ...scope }),
    );
  });
});

describe("the reconcile pass", () => {
  /** @scenario "The reconcile pass runs hourly, once across the fleet" */
  it("is a scheduled singleton that hands one pass to the outbox per wake", () => {
    const config = installed.reconcileProcess();
    const wokenAt = at(`${TODAY}T08:00:00Z`);

    const woken = insightScheduleReconcileWake(
      { lastPassAt: null },
      {
        at: wokenAt,
        now: wokenAt,
        key: config.name,
        projectId: "singleton",
        intent: (intentType, key, payload) => ({ intentType, messageKey: key, payload }),
      },
    );

    expect(config.schedule).toEqual({ everyMs: INSIGHT_SCHEDULE_RECONCILE_INTERVAL_MS });
    expect(INSIGHT_SCHEDULE_RECONCILE_INTERVAL_MS).toBe(60 * 60_000);
    expect(config.eventTypes).toEqual([]);
    expect(woken).toEqual({
      state: { lastPassAt: wokenAt },
      intents: [
        {
          intentType: INSIGHT_SCHEDULE_RECONCILE_INTENT,
          messageKey: `pass:${wokenAt}`,
          payload: { scheduledFor: wokenAt },
        },
      ],
    });
  });
});

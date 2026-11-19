/**
 * @vitest-environment node
 * How a run row reads to its person beside its run in flight row: the run in flight and the
 * last run's start, with and without a run in flight row.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { describe, expect, it } from "vitest";

import type { InsightDailyScheduleState } from "../../eventing/insight-daily-schedule.projection.ts";
import {
  type InsightRunInFlightState,
  NO_RUN_STARTED,
} from "../../eventing/insight-run-in-flight.projection.ts";
import {
  dailyRunFromState,
  dailyRunSettingFromState,
  decidedScheduleFromState,
} from "../insight-daily-schedule-row.rules.ts";

const STARTED_AT = Date.UTC(2026, 10, 19, 9, 0);
const SETTLED_AT = STARTED_AT + 60_000;

/** A row whose run-1 settled in Langy. */
function settledRow(): InsightDailyScheduleState {
  return {
    userId: "user-1",
    boardKind: "dashboard",
    boardId: "dashboard-1",
    boardName: "Costs",
    state: "on",
    offReason: null,
    hour: 9,
    timezone: "Europe/Amsterdam",
    maxInsights: 3,
    lastRunId: "run-1",
    lastRunAt: SETTLED_AT,
    lastRunOutcome: "filed",
    lastRunReason: null,
    lastRunFiled: 1,
    lastRunRenewed: 0,
    lastRunConversationId: "conversation-1",
    consecutiveSkips: 0,
    skipStreakSlot: null,
  };
}

const settingBeside = (row: Partial<InsightRunInFlightState>) =>
  dailyRunSettingFromState(settledRow(), { ...NO_RUN_STARTED, ...row });

/** How a run ended, as the run in flight row keeps it. */
const outcomeOf = ({ runId, filed }: { runId: string; filed: number }) => ({
  lastSettledRunId: runId,
  lastRunAt: SETTLED_AT,
  lastRunOutcome: "filed" as const,
  lastRunFiled: filed,
  lastRunRenewed: 0,
});

describe("given a run row with no run in flight row, as before Run now", () => {
  /** @scenario "A settled run keeps when it started on the board's row" */
  it("names no run in flight, and no start for its last run, so its settle time stands in", () => {
    const setting = settingBeside(NO_RUN_STARTED);

    expect(setting.runInFlight).toBeNull();
    expect(setting.lastRun).toMatchObject({ runId: "run-1", at: SETTLED_AT });
    expect(setting.lastRun).not.toHaveProperty("startedAt");
  });

  /** @scenario "A board with no run in flight row reads its last run from the run's row" */
  it("reads the last run, and how it ended, from the run row", () => {
    const { lastRun } = settingBeside(NO_RUN_STARTED);

    expect(lastRun).toEqual({
      runId: "run-1",
      at: SETTLED_AT,
      outcome: "filed",
      reason: null,
      filedCount: 1,
      renewedCount: 0,
      conversationId: "conversation-1",
    });
  });
});

describe("given a run in flight row that took a start and no outcome yet", () => {
  /** @scenario "A run in flight row with only a start reads its last run from the run's row" */
  it("reads the last run from the run row", () => {
    const setting = settingBeside({
      runId: "run-2",
      conversationId: "conversation-2",
      startedAt: SETTLED_AT + 1_000,
      newestRunId: "run-2",
      newestRunSlot: SETTLED_AT,
      newestRunSince: SETTLED_AT + 1_000,
    });

    expect(setting.lastRun).toMatchObject({ runId: "run-1", outcome: "filed", filedCount: 1 });
    expect(setting.runInFlight?.runId).toBe("run-2");
  });
});

describe("given a run in flight row that kept its settled run's start", () => {
  /** @scenario "A settled run keeps when it started on the board's row" */
  it("names no run in flight, and reads that start as the last run's", () => {
    const setting = settingBeside({
      runId: "run-1",
      conversationId: "conversation-1",
      startedAt: STARTED_AT,
      ...outcomeOf({ runId: "run-1", filed: 1 }),
    });

    expect(setting.runInFlight).toBeNull();
    expect(setting.lastRun).toMatchObject({ runId: "run-1", startedAt: STARTED_AT });
  });
});

describe("given a run in flight row whose last started run has not settled", () => {
  it("names that run in flight, and takes none of its start for the last run", () => {
    const setting = settingBeside({
      runId: "run-2",
      conversationId: "conversation-2",
      startedAt: SETTLED_AT + 1_000,
      ...outcomeOf({ runId: "run-1", filed: 1 }),
    });

    expect(setting.runInFlight).toEqual({
      runId: "run-2",
      conversationId: "conversation-2",
      startedAt: SETTLED_AT + 1_000,
    });
    expect(setting.lastRun).not.toHaveProperty("startedAt");
  });
});

describe("given a run row that took a run's outcome before its run in flight row did", () => {
  it("names no run in flight, and reads the run's start as the last run's", () => {
    const setting = settingBeside({
      runId: "run-1",
      conversationId: "conversation-1",
      startedAt: STARTED_AT,
    });

    expect(setting.runInFlight).toBeNull();
    expect(setting.lastRun).toMatchObject({ runId: "run-1", startedAt: STARTED_AT });
  });
});

describe("given a run in flight row that took a newer run's outcome before the run row did", () => {
  it("names no run in flight, and reads that run, with its start, as the last run", () => {
    const setting = settingBeside({
      runId: "run-2",
      conversationId: "conversation-2",
      startedAt: SETTLED_AT + 1_000,
      ...outcomeOf({ runId: "run-2", filed: 3 }),
    });

    expect(setting.runInFlight).toBeNull();
    expect(setting.lastRun).toMatchObject({
      runId: "run-2",
      filedCount: 3,
      startedAt: SETTLED_AT + 1_000,
    });
  });
});

describe("given a run row and a run in flight row that took a newer run's outcome", () => {
  const started: InsightRunInFlightState = {
    ...NO_RUN_STARTED,
    runId: "run-2",
    conversationId: "conversation-2",
    startedAt: SETTLED_AT + 1_000,
    ...outcomeOf({ runId: "run-2", filed: 3 }),
    lastRunAt: SETTLED_AT + 60_000,
  };

  describe("when the setting, the run list and the operator's list read the board", () => {
    /** @scenario "The setting, the run list and the operator's list read the same last run" */
    it("reads the run in flight row's last run on all three", () => {
      const state = settledRow();

      const setting = dailyRunSettingFromState(state, started).lastRun;
      const listed = dailyRunFromState({ id: "schedule-1", state, started }).lastRun;
      const [decided] = decidedScheduleFromState({
        scheduleId: "schedule-1",
        projectId: "project-1",
        state,
        started,
      });

      expect(listed).toEqual({
        at: SETTLED_AT + 60_000,
        outcome: "filed",
        reason: null,
        filedCount: 3,
        renewedCount: 0,
        conversationId: null,
      });
      expect(decided?.lastRun).toEqual(listed);
      expect(setting).toEqual({ ...listed, runId: "run-2", startedAt: SETTLED_AT + 1_000 });
    });
  });
});

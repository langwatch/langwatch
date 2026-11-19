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
import { dailyRunSettingFromState } from "../insight-daily-schedule-row.rules.ts";

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

const settingBeside = (row: InsightRunInFlightState) => dailyRunSettingFromState(settledRow(), row);

describe("given a run row with no run in flight row, as before Run now", () => {
  /** @scenario "A settled run keeps when it started on the board's row" */
  it("names no run in flight, and no start for its last run, so its settle time stands in", () => {
    const setting = settingBeside(NO_RUN_STARTED);

    expect(setting.runInFlight).toBeNull();
    expect(setting.lastRun).toMatchObject({ runId: "run-1", at: SETTLED_AT });
    expect(setting.lastRun).not.toHaveProperty("startedAt");
  });
});

describe("given a run in flight row that kept its settled run's start", () => {
  /** @scenario "A settled run keeps when it started on the board's row" */
  it("names no run in flight, and reads that start as the last run's", () => {
    const setting = settingBeside({
      runId: "run-1",
      conversationId: "conversation-1",
      startedAt: STARTED_AT,
      lastSettledRunId: "run-1",
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
      lastSettledRunId: "run-1",
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
      lastSettledRunId: null,
    });

    expect(setting.runInFlight).toBeNull();
    expect(setting.lastRun).toMatchObject({ runId: "run-1", startedAt: STARTED_AT });
  });
});

describe("given a run in flight row that took a newer run's outcome before the run row did", () => {
  it("names no run in flight, and no start for the run row's last run", () => {
    const setting = settingBeside({
      runId: "run-2",
      conversationId: "conversation-2",
      startedAt: SETTLED_AT + 1_000,
      lastSettledRunId: "run-2",
    });

    expect(setting.runInFlight).toBeNull();
    expect(setting.lastRun).toMatchObject({ runId: "run-1" });
    expect(setting.lastRun).not.toHaveProperty("startedAt");
  });
});

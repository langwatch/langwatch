/**
 * @vitest-environment node
 * A schedule's run in flight row as its events fold onto it, read beside the run's row: the
 * last run that started, in flight until it settles, and its start once it has.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_RUN_EVENT_VERSION,
  INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  type InsightRunSettledEventData,
} from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import { InsightMemoryStore } from "../../repositories/memory/insight-memory.store.ts";
import { MemoryInsightDailyScheduleProjectionRepository } from "../../repositories/memory/memory.insight-daily-schedule-projection.repository.ts";
import { MemoryInsightRunInFlightProjectionRepository } from "../../repositories/memory/memory.insight-run-in-flight-projection.repository.ts";
import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import { dailyRunSettingFromState } from "../../rules/insight-daily-schedule-row.rules.ts";
import {
  type InsightDailyRunEvent,
  InsightRunSettledEventSchema,
  InsightRunStartedEventSchema,
} from "../insight-daily-run.events.ts";
import {
  applyInsightDailyRunEvent,
  createInsightDailyScheduleProjection,
} from "../insight-daily-schedule.projection.ts";
import {
  applyInsightRunInFlightEvent,
  createInsightRunInFlightProjection,
} from "../insight-run-in-flight.projection.ts";

const T0 = Date.UTC(2026, 10, 19, 9, 37);
const BOARD = { kind: "dashboard", id: "dashboard-1", name: "Costs" } as const;
const OWNER = { projectId: "project-1", userId: "user-1", board: BOARD };
const SCHEDULE = { scheduleId: dailyScheduleId(OWNER), userId: OWNER.userId, board: BOARD };
const ROWS = InsightMemoryStore.create();
const PROJECTION = createInsightRunInFlightProjection({
  store: MemoryInsightRunInFlightProjectionRepository.create({ rows: ROWS }),
});
const SCHEDULE_PROJECTION = createInsightDailyScheduleProjection({
  store: MemoryInsightDailyScheduleProjectionRepository.create({ rows: ROWS }),
});

const envelope = (at: number) => ({
  id: `event-${at}`,
  aggregateId: SCHEDULE.scheduleId,
  aggregateType: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
  tenantId: "project-1",
  createdAt: at,
  occurredAt: at,
  version: INSIGHT_DAILY_RUN_EVENT_VERSION,
});

const started = (at: number, data: Record<string, unknown> = {}) =>
  InsightRunStartedEventSchema.parse({
    ...envelope(at),
    type: INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_STARTED,
    data: {
      ...SCHEDULE,
      runId: "run-1",
      slot: T0,
      conversationId: "conversation-1",
      turnId: "turn-1",
      ...data,
    },
  });

const settled = (at: number, data: Partial<InsightRunSettledEventData> = {}) =>
  InsightRunSettledEventSchema.parse({
    ...envelope(at),
    type: INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED,
    data: {
      ...SCHEDULE,
      runId: "run-1",
      slot: T0,
      outcome: "filed",
      reason: null,
      filedCount: 2,
      conversationId: "conversation-1",
      ...data,
    },
  });

/** Both rows as the two projections fold the same events, and how their person reads them. */
function foldAll(events: InsightDailyRunEvent[]) {
  let schedule = SCHEDULE_PROJECTION.init();
  let row = PROJECTION.init();
  for (const event of events) {
    schedule = applyInsightDailyRunEvent(schedule, event);
    row = applyInsightRunInFlightEvent(row, event);
  }
  return { row, setting: dailyRunSettingFromState(schedule, row) };
}

describe("given a run was requested for a board", () => {
  describe("when the run starts, and then settles", () => {
    /** @scenario "A started run names its conversation on the board's row" */
    it("names the run's conversation as the run in flight, then no run in flight", () => {
      const running = foldAll([started(T0 + 1_000)]);
      const ran = foldAll([started(T0 + 1_000), settled(T0 + 60_000)]);

      expect(running.setting.runInFlight).toEqual({
        runId: "run-1",
        conversationId: "conversation-1",
        startedAt: T0 + 1_000,
      });
      expect(ran.setting.runInFlight).toBeNull();
      expect(ran.setting.lastRun).toMatchObject({ runId: "run-1", outcome: "filed" });
    });

    /** @scenario "A settled run keeps when it started on the board's row" */
    it("keeps the run's start on its row as the last run's", () => {
      const { row, setting } = foldAll([started(T0 + 1_000), settled(T0 + 60_000)]);

      expect(row).toEqual({
        runId: "run-1",
        conversationId: "conversation-1",
        startedAt: T0 + 1_000,
        lastSettledRunId: "run-1",
      });
      expect(setting.lastRun?.startedAt).toBe(T0 + 1_000);
    });
  });

  describe("when a later run settles without starting", () => {
    /** @scenario "A settled run keeps when it started on the board's row" */
    it("drops the earlier run's start, and names neither run in flight", () => {
      const { row, setting } = foldAll([
        started(T0 + 1_000),
        settled(T0 + 60_000),
        settled(T0 + 120_000, {
          runId: "run-2",
          outcome: "nothing",
          reason: "no_new_traces",
          filedCount: 0,
          conversationId: null,
        }),
      ]);

      expect(row).toMatchObject({ runId: null, startedAt: null, lastSettledRunId: "run-2" });
      expect(setting.runInFlight).toBeNull();
      expect(setting.lastRun).toMatchObject({ runId: "run-2" });
      expect(setting.lastRun).not.toHaveProperty("startedAt");
    });
  });

  describe("when a lost run settles after a newer run started", () => {
    it("keeps the newer run in flight, and names no start for the lost one", () => {
      const { setting } = foldAll([
        started(T0 + 1_000),
        started(T0 + 3_600_000, { runId: "run-2", conversationId: "conversation-2" }),
        settled(T0 + 3_600_001),
      ]);

      expect(setting.runInFlight?.runId).toBe("run-2");
      expect(setting.lastRun).toMatchObject({ runId: "run-1" });
      expect(setting.lastRun).not.toHaveProperty("startedAt");
    });
  });

  describe("when a retried attempt records the start of a run already in flight", () => {
    /** @scenario "A settled run keeps when it started on the board's row" */
    it("keeps the first start, as a replay that keeps the first of a key does", () => {
      const running = applyInsightRunInFlightEvent(PROJECTION.init(), started(T0 + 1_000));

      const retried = applyInsightRunInFlightEvent(running, started(T0 + 2_000));
      const { setting } = foldAll([started(T0 + 1_000), started(T0 + 2_000), settled(T0 + 60_000)]);

      expect(retried).toBe(running);
      expect(setting.lastRun?.startedAt).toBe(T0 + 1_000);
    });
  });

  describe("when the start or the outcome of a run that already settled is delivered again", () => {
    it("leaves the row as it is", () => {
      const ran = foldAll([started(T0 + 1_000), settled(T0 + 60_000)]).row;

      expect(applyInsightRunInFlightEvent(ran, started(T0 + 1_000))).toBe(ran);
      expect(applyInsightRunInFlightEvent(ran, settled(T0 + 60_000))).toBe(ran);
    });
  });
});

describe("given a start on a stream that is not its person's and board's", () => {
  it("folds nothing", () => {
    const forged = started(T0 + 1_000, { userId: "user-2" });

    expect(applyInsightRunInFlightEvent(PROJECTION.init(), forged)).toBe(PROJECTION.init());
  });
});

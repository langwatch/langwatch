/**
 * @vitest-environment node
 * The run's row as its events fold onto it: the board, whose it is and how the last run ended.
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
import {
  InsightRunRequestedEventSchema,
  InsightRunSettledEventSchema,
} from "../insight-daily-run.events.ts";
import {
  applyInsightDailyRunEvent,
  createInsightDailyScheduleProjection,
} from "../insight-daily-schedule.projection.ts";

const T0 = Date.UTC(2026, 9, 10, 9, 37);
const BOARD = { kind: "dashboard", id: "dashboard-1", name: "Costs" } as const;
const SCHEDULE = { scheduleId: "schedule-1", userId: "user-1", board: BOARD };
const PROJECTION = createInsightDailyScheduleProjection({
  store: MemoryInsightDailyScheduleProjectionRepository.create({
    rows: InsightMemoryStore.create(),
  }),
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

describe("given a run that settled", () => {
  it("folds the board, the person and how the run ended onto the row", () => {
    const state = applyInsightDailyRunEvent(PROJECTION.init(), settled(T0 + 60_000));

    expect(state).toEqual({
      userId: "user-1",
      boardKind: "dashboard",
      boardId: "dashboard-1",
      boardName: "Costs",
      lastRunId: "run-1",
      lastRunAt: T0 + 60_000,
      lastRunOutcome: "filed",
      lastRunReason: null,
      lastRunFiled: 2,
      lastRunConversationId: "conversation-1",
    });
  });

  describe("when the same run is settled again as failed", () => {
    /** @scenario "A settled run keeps its first outcome" */
    it("still reads filed", () => {
      const first = applyInsightDailyRunEvent(PROJECTION.init(), settled(T0 + 60_000));

      const again = applyInsightDailyRunEvent(
        first,
        settled(T0 + 120_000, { outcome: "failed", reason: "error", filedCount: 0 }),
      );

      expect(again).toBe(first);
    });
  });

  describe("when a later run settles", () => {
    it("reads the later run, with the board's name as that run found it", () => {
      const first = applyInsightDailyRunEvent(PROJECTION.init(), settled(T0 + 60_000));

      const later = applyInsightDailyRunEvent(
        first,
        settled(T0 + 86_400_000, {
          runId: "run-2",
          board: { ...BOARD, name: "Costs and errors" },
          outcome: "skipped",
          reason: "no_access",
          filedCount: 0,
          conversationId: null,
        }),
      );

      expect(later).toMatchObject({
        boardName: "Costs and errors",
        lastRunId: "run-2",
        lastRunAt: T0 + 86_400_000,
        lastRunOutcome: "skipped",
        lastRunReason: "no_access",
        lastRunFiled: 0,
        lastRunConversationId: null,
      });
    });
  });
});

describe("given a run that was only requested", () => {
  it("is not an event the row folds", () => {
    const requested = InsightRunRequestedEventSchema.parse({
      ...envelope(T0),
      type: INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_REQUESTED,
      data: { ...SCHEDULE, requestId: "run-1", maxInsights: 3 },
    });

    expect(PROJECTION.eventTypes).toEqual([INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED]);
    expect(applyInsightDailyRunEvent(PROJECTION.init(), requested)).toBe(PROJECTION.init());
  });
});

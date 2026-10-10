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
import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import {
  InsightRunRequestedEventSchema,
  InsightRunSettledEventSchema,
  InsightScheduleConfiguredEventSchema,
  InsightScheduleRearmRequestedEventSchema,
  InsightScheduleTurnedOffEventSchema,
} from "../insight-daily-run.events.ts";
import {
  applyInsightDailyRunEvent,
  createInsightDailyScheduleProjection,
} from "../insight-daily-schedule.projection.ts";

const T0 = Date.UTC(2026, 9, 10, 9, 37);
const BOARD = { kind: "dashboard", id: "dashboard-1", name: "Costs" } as const;
const OWNER = { projectId: "project-1", userId: "user-1", board: BOARD };
const SCHEDULE = { scheduleId: dailyScheduleId(OWNER), userId: OWNER.userId, board: BOARD };
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
      state: "undecided",
      hour: null,
      timezone: null,
      maxInsights: null,
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

describe("given an outcome on a stream that is not its person's and board's", () => {
  /** @scenario "An outcome that names another schedule changes no row" */
  it.each([
    ["another person", { userId: "user-2" }],
    ["another board", { board: { ...BOARD, id: "dashboard-2" } }],
  ])("folds nothing for an outcome that names %s", (_what, other) => {
    const first = applyInsightDailyRunEvent(PROJECTION.init(), settled(T0 + 60_000));

    const forged = settled(T0 + 120_000, { runId: "run-2", ...other });

    expect(applyInsightDailyRunEvent(PROJECTION.init(), forged)).toBe(PROJECTION.init());
    expect(applyInsightDailyRunEvent(first, forged)).toBe(first);
  });

  it("folds nothing for the same outcome recorded in another project", () => {
    const elsewhere = InsightRunSettledEventSchema.parse({
      ...settled(T0 + 60_000),
      tenantId: "project-2",
    });

    expect(applyInsightDailyRunEvent(PROJECTION.init(), elsewhere)).toBe(PROJECTION.init());
  });
});

describe("given a run that was only requested", () => {
  it("is not an event the row folds", () => {
    const requested = InsightRunRequestedEventSchema.parse({
      ...envelope(T0),
      type: INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_REQUESTED,
      data: { ...SCHEDULE, requestId: "run-1", maxInsights: 3 },
    });

    expect(PROJECTION.eventTypes).not.toContain(INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_REQUESTED);
    expect(applyInsightDailyRunEvent(PROJECTION.init(), requested)).toBe(PROJECTION.init());
  });
});

const SETTINGS = { hour: 9, timezone: "Europe/Amsterdam", maxInsights: 5 } as const;

const configured = (at: number, data: Record<string, unknown> = {}) =>
  InsightScheduleConfiguredEventSchema.parse({
    ...envelope(at),
    type: INSIGHT_DAILY_RUN_EVENT_TYPES.CONFIGURED,
    data: { ...SCHEDULE, ...SETTINGS, ...data },
  });

const turnedOff = (at: number, data: Record<string, unknown> = {}) =>
  InsightScheduleTurnedOffEventSchema.parse({
    ...envelope(at),
    type: INSIGHT_DAILY_RUN_EVENT_TYPES.TURNED_OFF,
    data: { ...SCHEDULE, by: "person", reason: null, ...data },
  });

describe("given a person turned their daily run on", () => {
  const on = applyInsightDailyRunEvent(PROJECTION.init(), configured(T0));

  /** @scenario "A setting and a run's outcome fold onto one row" */
  it("folds the setting onto the row, and a run's outcome beside it", () => {
    const ran = applyInsightDailyRunEvent(on, settled(T0 + 60_000));

    expect(on).toMatchObject({
      userId: "user-1",
      boardKind: "dashboard",
      boardId: "dashboard-1",
      boardName: "Costs",
      state: "on",
      ...SETTINGS,
      lastRunId: null,
    });
    expect(ran).toMatchObject({ state: "on", ...SETTINGS, lastRunId: "run-1", lastRunFiled: 2 });
  });

  it("reads the changed hour, zone and maximum, and keeps the last run", () => {
    const ran = applyInsightDailyRunEvent(on, settled(T0 + 60_000));

    const changed = applyInsightDailyRunEvent(
      ran,
      configured(T0 + 120_000, { hour: 17, timezone: "UTC", maxInsights: 1 }),
    );

    expect(changed).toMatchObject({
      state: "on",
      hour: 17,
      timezone: "UTC",
      maxInsights: 1,
      lastRunId: "run-1",
      lastRunOutcome: "filed",
    });
  });

  describe("when they turn it off", () => {
    it("reads off, and keeps what they chose and how the last run ended", () => {
      const ran = applyInsightDailyRunEvent(on, settled(T0 + 60_000));

      const off = applyInsightDailyRunEvent(ran, turnedOff(T0 + 120_000));

      expect(off).toMatchObject({ state: "off", ...SETTINGS, lastRunOutcome: "filed" });
    });
  });

  describe("when a run finds the board gone and turns the schedule off", () => {
    it("reads off", () => {
      const off = applyInsightDailyRunEvent(
        on,
        turnedOff(T0 + 120_000, { by: "system", reason: "board_deleted" }),
      );

      expect(off).toMatchObject({ state: "off", ...SETTINGS });
    });
  });

  it("folds nothing for a reconcile pass's request to arm", () => {
    const rearm = InsightScheduleRearmRequestedEventSchema.parse({
      ...envelope(T0 + 120_000),
      type: INSIGHT_DAILY_RUN_EVENT_TYPES.REARM_REQUESTED,
      data: { ...SCHEDULE, hour: 23, timezone: "UTC", maxInsights: 1 },
    });

    expect(PROJECTION.eventTypes).not.toContain(INSIGHT_DAILY_RUN_EVENT_TYPES.REARM_REQUESTED);
    expect(applyInsightDailyRunEvent(on, rearm)).toBe(on);
  });
});

describe("given a board a person never decided on", () => {
  /** @scenario "No thanks from the offer stores off" */
  it("reads off with nothing chosen once they say no", () => {
    const off = applyInsightDailyRunEvent(PROJECTION.init(), turnedOff(T0));

    expect(off).toMatchObject({
      userId: "user-1",
      boardId: "dashboard-1",
      state: "off",
      hour: null,
      timezone: null,
      maxInsights: null,
    });
  });

  /** @scenario "A board that is gone turns off no daily run the person never turned on" */
  it("stays undecided when a run finds the board gone, and stays off when it was off", () => {
    const bySystem = turnedOff(T0 + 60_000, { by: "system", reason: "board_deleted" });
    const off = applyInsightDailyRunEvent(PROJECTION.init(), turnedOff(T0));

    expect(applyInsightDailyRunEvent(PROJECTION.init(), bySystem)).toBe(PROJECTION.init());
    expect(applyInsightDailyRunEvent(off, bySystem)).toBe(off);
  });
});

describe("given a setting on a stream that is not its person's and board's", () => {
  /** @scenario "A setting whose schedule is not its person's and board's changes nothing" */
  it.each([
    ["another person", { userId: "user-2" }],
    ["another board", { board: { ...BOARD, id: "dashboard-2" } }],
  ])("folds nothing for a setting or an off that names %s", (_what, other) => {
    const on = applyInsightDailyRunEvent(PROJECTION.init(), configured(T0));

    expect(applyInsightDailyRunEvent(PROJECTION.init(), configured(T0, other))).toBe(
      PROJECTION.init(),
    );
    expect(applyInsightDailyRunEvent(on, turnedOff(T0 + 60_000, other))).toBe(on);
  });
});

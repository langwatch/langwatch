/**
 * @vitest-environment node
 * A schedule's run in flight row as its events fold onto it, read beside the run's row: the
 * last run that started, in flight until it settles, and its start once it has.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { buildIntentAccessor } from "@langwatch/eventing";
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
import { runBoardIntentSchema } from "../insight-daily-run.intent.ts";
import { insightDailyRunStateSchema, insightRunRequested } from "../insight-daily-run.process.ts";
import {
  applyInsightDailyRunEvent,
  createInsightDailyScheduleProjection,
} from "../insight-daily-schedule.projection.ts";
import {
  applyInsightRunInFlightEvent,
  createInsightRunInFlightProjection,
} from "../insight-run-in-flight.projection.ts";

const T0 = Date.UTC(2026, 10, 19, 9, 37);
const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;
const quiet = { outcome: "nothing", reason: "no_new_traces", filedCount: 0 } as const;
const lostAs = {
  outcome: "failed",
  reason: "timeout",
  filedCount: 0,
  conversationId: null,
} as const;
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
        lastRunAt: T0 + 60_000,
        lastRunOutcome: "filed",
        lastRunReason: null,
        lastRunFiled: 2,
        lastRunRenewed: 0,
        lastRunConversationId: "conversation-1",
        newestRunId: "run-1",
        newestRunSlot: T0,
        newestRunSince: null,
        lastSettledRunSlot: T0,
        lastSettledRunSince: null,
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
          slot: T0 + DAY,
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

  describe("when a lost run's own outcome lands after a newer run started", () => {
    it("reads the lost run's outcome as the last run, and keeps the newer run in flight", () => {
      const prior = { runId: "run-0", slot: T0 - DAY, since: T0 - DAY };
      const lost = { runId: "run-1", slot: T0, since: T0 };
      const newer = { runId: "run-2", slot: T0 + 2 * HOUR, since: T0 + 2 * HOUR };
      const { row, setting } = foldAll([
        started(T0 - DAY + 1_000, prior),
        settled(T0 - DAY + 60_000, { ...prior, ...quiet }),
        started(T0 + 1_000, lost),
        started(T0 + 2 * HOUR + 1_000, { ...newer, conversationId: "conversation-2" }),
        settled(T0 + 2 * HOUR + 2_000, lost),
      ]);

      expect(row).toMatchObject({ lastSettledRunId: "run-1", newestRunId: "run-2" });
      expect(setting.runInFlight?.runId).toBe("run-2");
      expect(setting.lastRun).toMatchObject({ runId: "run-1", outcome: "filed" });
      expect(setting.lastRun).toMatchObject({ startedAt: T0 });
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

describe("given an operator's run that settled, and the day's wake that came late", () => {
  // The operator asked after the slot was due, so the wake's run is for an earlier slot.
  const ASKED_AT = T0 + 3 * HOUR;
  const operator = { runId: "request-1", slot: ASKED_AT, since: ASKED_AT };
  const wake = {
    runId: `slot:${T0}`,
    slot: T0,
    since: ASKED_AT + 100_000,
    conversationId: "conversation-2",
  };
  const before = [
    started(ASKED_AT + 1_000, operator),
    settled(ASKED_AT + 60_000, { ...operator, ...quiet }),
  ];
  const wakeStarted = started(ASKED_AT + 120_000, { ...wake, turnId: "turn-2" });

  describe("when the wake's run starts, and then files", () => {
    /** @scenario "A late wake's run after an operator's run shows in flight and as the last run" */
    it("names the wake's run in flight, and then its filed outcome as the last run", () => {
      const running = foldAll([...before, wakeStarted]);
      const ran = foldAll([...before, wakeStarted, settled(ASKED_AT + 180_000, wake)]);

      expect(running.setting.runInFlight).toEqual({
        runId: wake.runId,
        conversationId: "conversation-2",
        startedAt: ASKED_AT + 120_000,
      });
      expect(ran.setting.runInFlight).toBeNull();
      expect(ran.setting.lastRun).toMatchObject({
        runId: wake.runId,
        outcome: "filed",
        filedCount: 2,
        startedAt: ASKED_AT + 120_000,
      });
    });
  });
});

describe("given a run that recorded the run it replaced as lost, and then filed", () => {
  const replaced = { runId: "run-1", slot: T0, since: T0 };
  const newer = {
    runId: "run-2",
    slot: T0 + DAY,
    since: T0 + DAY,
    conversationId: "conversation-2",
  };
  const events = [
    started(T0 + 1_000, replaced),
    settled(T0 + DAY + 1_000, { ...replaced, ...lostAs }),
    started(T0 + DAY + 2_000, { ...newer, turnId: "turn-2" }),
    settled(T0 + DAY + 60_000, newer),
  ];

  describe("when the replaced run's outcome is recorded again", () => {
    /** @scenario "A repeated outcome of a replaced run leaves the newer run as the last run" */
    it("still reads the newer run's filed outcome as the last run, and no run in flight", () => {
      const ran = foldAll(events);
      const repeat = settled(T0 + DAY + 120_000, { ...replaced, ...lostAs });

      const { setting } = foldAll([...events, repeat]);

      expect(applyInsightRunInFlightEvent(ran.row, repeat)).toBe(ran.row);
      expect(setting.runInFlight).toBeNull();
      expect(setting.lastRun).toMatchObject({
        runId: "run-2",
        outcome: "filed",
        startedAt: T0 + DAY + 2_000,
      });
    });
  });
});

describe("given a run that recorded the run it replaced as lost, and started", () => {
  const replaced = { runId: "run-2", slot: T0 + DAY, since: T0 + DAY };
  const events = [
    started(T0 + DAY + 1_000, { ...replaced, conversationId: "conversation-2" }),
    settled(T0 + 2 * DAY + 1_000, { ...replaced, ...lostAs }),
    started(T0 + 2 * DAY + 2_000, {
      runId: "run-3",
      slot: T0 + 2 * DAY,
      since: T0 + 2 * DAY,
      conversationId: "conversation-3",
    }),
  ];

  describe("when an even older run's outcome arrives late", () => {
    /** @scenario "A late outcome of an older run leaves the newer run in flight" */
    it("keeps the new run in flight, and the lost run as the last run", () => {
      const taken = foldAll(events);
      const late = settled(T0 + 2 * DAY + 3_000, { since: T0 });

      const { setting } = foldAll([...events, late]);

      expect(applyInsightRunInFlightEvent(taken.row, late)).toBe(taken.row);
      expect(setting.runInFlight?.runId).toBe("run-3");
      expect(setting.lastRun).toMatchObject({ runId: "run-2", outcome: "failed" });
    });
  });
});

describe("given a newer run that started and settled after an older one", () => {
  const older = { runId: "run-1", slot: T0, since: T0 };
  const newer = {
    runId: "run-2",
    slot: T0 + DAY,
    since: T0 + DAY,
    conversationId: "conversation-2",
  };
  const events = [
    started(T0 + 1_000, older),
    settled(T0 + 60_000, older),
    started(T0 + DAY + 1_000, { ...newer, turnId: "turn-2" }),
    settled(T0 + DAY + 60_000, newer),
  ];

  describe("when the older run's start is recorded after the newer run's events", () => {
    /** @scenario "A late start of an older run names no run in flight" */
    it("leaves the row, and names no run in flight", () => {
      const ran = foldAll(events);
      const late = started(T0 + DAY + 120_000, older);

      const { setting } = foldAll([...events, late]);

      expect(applyInsightRunInFlightEvent(ran.row, late)).toBe(ran.row);
      expect(setting.runInFlight).toBeNull();
    });
  });
});

describe("given an operator's run handed over before runs carried their start, then lost", () => {
  // The operator asked after the next slot was due, so its slot is later than the late wake's.
  const ASKED_AT = T0 + DAY + 3 * HOUR;
  const operator = { runId: "request-1", slot: ASKED_AT };
  const wake = {
    runId: `slot:${T0 + DAY}`,
    slot: T0 + DAY,
    since: ASKED_AT + 2 * HOUR,
    conversationId: "conversation-2",
  };
  const events = [
    started(ASKED_AT + 1_000, operator),
    settled(ASKED_AT + 2 * HOUR + 1_000, { ...operator, since: ASKED_AT, ...lostAs }),
    started(ASKED_AT + 2 * HOUR + 2_000, { ...wake, turnId: "turn-2" }),
  ];

  describe("when the lost run's own outcome, which carries no start, arrives late", () => {
    /** @scenario "A lost run's own late outcome, once recorded as lost, leaves the row" */
    it("leaves the row: the late wake's run stays in flight, beside the lost run", () => {
      const taken = foldAll(events);
      const late = settled(ASKED_AT + 2 * HOUR + 3_000, { ...operator, ...quiet });

      const { setting } = foldAll([...events, late]);

      expect(applyInsightRunInFlightEvent(taken.row, late)).toBe(taken.row);
      expect(setting.runInFlight?.runId).toBe(wake.runId);
      expect(setting.lastRun).toMatchObject({ runId: "request-1", outcome: "failed" });
    });
  });
});

describe("given an operator's run that carries no start and settled, for a later slot", () => {
  const ASKED_AT = T0 + DAY + 3 * HOUR;
  const operator = { runId: "request-1", slot: ASKED_AT };
  const before = [
    started(ASKED_AT + 1_000, operator),
    settled(ASKED_AT + 60_000, { ...operator, ...quiet }),
  ];
  const wake = {
    runId: `slot:${T0 + DAY}`,
    slot: T0 + DAY,
    since: ASKED_AT + 100_000,
    conversationId: "conversation-2",
  };
  const wakeStarted = started(ASKED_AT + 120_000, { ...wake, turnId: "turn-2" });

  describe("when a late wake's run for an earlier slot starts with its start, and files", () => {
    /** @scenario "A run that started after the slot of one that carries none is taken" */
    it("names the wake's run in flight, and then its filed outcome as the last run", () => {
      const running = foldAll([...before, wakeStarted]);
      const ran = foldAll([...before, wakeStarted, settled(ASKED_AT + 180_000, wake)]);

      expect(running.setting.runInFlight?.runId).toBe(wake.runId);
      expect(ran.setting.runInFlight).toBeNull();
      expect(ran.setting.lastRun).toMatchObject({
        runId: wake.runId,
        outcome: "filed",
        startedAt: ASKED_AT + 120_000,
      });
    });
  });
});

describe("given a run that replaced a lost run, and started before the lost run's outcome", () => {
  // A worker without the shared queue can append the outcome a run records for the run it
  // replaces after that run's own start.
  const prior = { runId: "run-0", slot: T0 - DAY, since: T0 - DAY };
  const lost = { runId: "run-1", slot: T0, since: T0 };
  const replacing = { runId: "run-2", slot: T0 + 2 * HOUR, since: T0 + 2 * HOUR };
  const events = [
    started(T0 - DAY + 1_000, prior),
    settled(T0 - DAY + 60_000, { ...prior, ...quiet }),
    started(T0 + 1_000, lost),
    started(T0 + 2 * HOUR + 1_000, { ...replacing, conversationId: "conversation-2" }),
  ];
  const lostOutcome = settled(T0 + 2 * HOUR + 2_000, { ...lost, ...lostAs });

  describe("when the lost run's outcome lands, and then the replacing run's", () => {
    /** @scenario "A lost run's outcome that lands after its replacement started is the last run" */
    it("reads the lost run's timeout as the last run while its replacement runs", () => {
      const { row, setting } = foldAll([...events, lostOutcome]);
      const ran = foldAll([...events, lostOutcome, settled(T0 + 3 * HOUR, replacing)]);

      expect(row).toMatchObject({
        runId: "run-2",
        lastSettledRunId: "run-1",
        newestRunId: "run-2",
      });
      expect(setting.runInFlight).toEqual({
        runId: "run-2",
        conversationId: "conversation-2",
        startedAt: T0 + 2 * HOUR + 1_000,
      });
      expect(setting.lastRun).toMatchObject({
        runId: "run-1",
        outcome: "failed",
        reason: "timeout",
      });
      expect(ran.setting.runInFlight).toBeNull();
      expect(ran.setting.lastRun).toMatchObject({ runId: "run-2", outcome: "filed" });
    });
  });
});

describe("given a late wake's run that carries its start and settled", () => {
  const wake = { runId: `slot:${T0}`, slot: T0, since: T0 + HOUR };
  const before = [
    started(T0 + HOUR + 1_000, wake),
    settled(T0 + HOUR + 60_000, { ...wake, ...quiet }),
  ];
  // An older worker strips the start in transit, so the operator's run carries only its slot.
  const operator = { runId: "request-1", slot: T0 + 3 * HOUR, conversationId: "conversation-2" };
  const operatorStarted = started(T0 + 3 * HOUR + 1_000, { ...operator, turnId: "turn-2" });

  describe("when an operator's later run that carries no start starts, and files", () => {
    /** @scenario "A later run that carries no start is taken after one that carries its start" */
    it("names the operator's run in flight, and then its filed outcome as the last run", () => {
      const running = foldAll([...before, operatorStarted]);
      const ran = foldAll([...before, operatorStarted, settled(T0 + 3 * HOUR + 60_000, operator)]);

      expect(running.setting.runInFlight?.runId).toBe("request-1");
      expect(ran.setting.runInFlight).toBeNull();
      expect(ran.setting.lastRun).toMatchObject({
        runId: "request-1",
        outcome: "filed",
        startedAt: T0 + 3 * HOUR + 1_000,
      });
    });
  });
});

describe("given an operator's run that settled, and a late wake's run started after it", () => {
  // The wake is for a slot before the operator asked, and started once that run settled.
  const ASKED_AT = T0 + 3 * HOUR;
  const operator = { runId: "request-1", slot: ASKED_AT, since: ASKED_AT };
  const wake = { runId: `slot:${T0}`, slot: T0, since: ASKED_AT + HOUR };
  const events = [
    started(ASKED_AT + 1_000, operator),
    settled(ASKED_AT + 60_000, { ...operator, ...quiet }),
    started(ASKED_AT + HOUR + 1_000, { ...wake, conversationId: "conversation-2" }),
  ];

  describe("when an older worker records the wake's run as lost, without its start", () => {
    /** @scenario "A lost run's outcome that carries no start is ordered by its run's own start" */
    it("reads the wake's run's timeout as the last run, and keeps its start as the newest", () => {
      const lost = settled(ASKED_AT + 3 * HOUR, { runId: wake.runId, slot: wake.slot, ...lostAs });

      const { row, setting } = foldAll([...events, lost]);

      expect(row).toMatchObject({
        lastSettledRunId: wake.runId,
        lastSettledRunSince: wake.since,
        newestRunSince: wake.since,
      });
      expect(setting.runInFlight).toBeNull();
      expect(setting.lastRun).toMatchObject({ runId: wake.runId, outcome: "failed" });
    });
  });
});

describe("given a row whose newest run carries its start, and an older release's state", () => {
  const lost = { runId: "request-1", slot: T0, since: T0 };
  const before = [started(T0 + 1_000, lost)];
  // Only the fields every release keeps: a pending run with no slot, and no count or key.
  const olderState = insightDailyRunStateSchema.parse({
    lastRequestId: "request-1",
    pendingRun: { runId: "request-1", since: T0 },
  });
  const processContext = (at: number) => ({
    at,
    now: at,
    key: SCHEDULE.scheduleId,
    projectId: OWNER.projectId,
    intent: buildIntentAccessor({
      runBoard: { schema: runBoardIntentSchema, run: async () => {} },
    }),
  });

  describe("when the process starts the next run, which records the lost one, and it files", () => {
    /** @scenario "A run started from process state an older release kept is taken" */
    it("hands it the lost run, its start as its slot, and takes it in flight, then last", () => {
      const request = { ...SCHEDULE, requestId: "request-2", maxInsights: 3 } as const;
      const evolution = insightRunRequested(olderState, request, processContext(T0 + DAY));
      const run = runBoardIntentSchema.parse(evolution.intents?.[0]?.payload);
      const ref = { runId: run.runId, slot: run.slot, since: run.since };
      const lostOutcome = settled(T0 + DAY + 500, { ...run.supersedes, ...lostAs });
      const runStarted = started(T0 + DAY + 1_000, {
        ...ref,
        conversationId: "conversation-2",
        turnId: "turn-2",
      });

      const running = foldAll([...before, lostOutcome, runStarted]);
      const ran = foldAll([...before, lostOutcome, runStarted, settled(T0 + DAY + 60_000, ref)]);

      expect(run.since).toBe(T0 + DAY);
      expect(run.supersedes).toEqual(lost);
      expect(running.setting.lastRun).toMatchObject({ runId: "request-1", outcome: "failed" });
      expect(running.setting.runInFlight?.runId).toBe("request-2");
      expect(ran.setting.lastRun).toMatchObject({ runId: "request-2", outcome: "filed" });
    });
  });
});

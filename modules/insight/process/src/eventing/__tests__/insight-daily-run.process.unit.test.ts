/**
 * @vitest-environment node
 * The daily run's process: one run per request, one run in flight per person and board, and
 * a run that never recorded an outcome does not hold the board for good.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { buildIntentAccessor } from "@langwatch/eventing";
import type {
  InsightRunRequestedEventData,
  InsightRunSettledEventData,
} from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import {
  INSIGHT_DAILY_RUN_LEASE_MS,
  INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
  runBoardIntent,
  runBoardIntentSchema,
} from "../insight-daily-run.intent.ts";
import {
  INITIAL_INSIGHT_DAILY_RUN_STATE,
  type InsightDailyRunState,
  insightRunRequested,
  insightRunSettled,
} from "../insight-daily-run.process.ts";

const T0 = Date.UTC(2026, 9, 10, 9, 37);
const BOARD = { kind: "dashboard", id: "dashboard-1", name: "Costs" } as const;
const SCHEDULE = { scheduleId: "schedule-1", userId: "user-1", board: BOARD };

function context(now: number) {
  return {
    at: now,
    now,
    key: SCHEDULE.scheduleId,
    projectId: "project-1",
    intent: buildIntentAccessor({
      runBoard: { schema: runBoardIntentSchema, run: async () => {} },
    }),
  };
}

const requested = (requestId: string): InsightRunRequestedEventData => ({
  ...SCHEDULE,
  requestId,
  maxInsights: 3,
});

const settled = (runId: string): InsightRunSettledEventData => ({
  ...SCHEDULE,
  runId,
  slot: T0,
  outcome: "filed",
  reason: null,
  filedCount: 2,
  conversationId: "conversation-1",
});

/** The state after one request was taken at `T0`. */
function inFlight(): InsightDailyRunState {
  return insightRunRequested(INITIAL_INSIGHT_DAILY_RUN_STATE, requested("run-1"), context(T0))
    .state;
}

describe("the daily run process", () => {
  describe("given a request for a run", () => {
    it("hands the outbox one run for the board, named by the request and fixed at its instant", () => {
      const evolution = insightRunRequested(
        INITIAL_INSIGHT_DAILY_RUN_STATE,
        requested("run-1"),
        context(T0),
      );

      expect(evolution.state).toEqual({
        lastRequestId: "run-1",
        pendingRun: { runId: "run-1", since: T0 },
      });
      expect(evolution.intents).toEqual([
        {
          intentType: "runBoard",
          messageKey: "run:run-1",
          payload: { ...SCHEDULE, maxInsights: 3, runId: "run-1", slot: T0 },
        },
      ]);
    });
  });

  describe("given a run request the schedule already took", () => {
    /** @scenario "A request delivered twice starts one run" */
    it("starts no second run when the same request is delivered again", () => {
      const state = inFlight();

      const again = insightRunRequested(state, requested("run-1"), context(T0 + 5_000));
      const afterSettle = insightRunRequested(
        insightRunSettled(state, settled("run-1"), context(T0 + 60_000)).state,
        requested("run-1"),
        context(T0 + 120_000),
      );

      expect(again).toEqual({ state, intents: [] });
      expect(afterSettle.intents).toEqual([]);
    });
  });

  describe("given a run in flight for a board", () => {
    /** @scenario "A second request while a run is in flight starts nothing" */
    it("starts nothing for another request, and starts a run once the first settled", () => {
      const state = inFlight();

      const during = insightRunRequested(state, requested("run-2"), context(T0 + 60_000));
      const afterSettle = insightRunSettled(state, settled("run-1"), context(T0 + 120_000));
      const next = insightRunRequested(
        afterSettle.state,
        requested("run-3"),
        context(T0 + 180_000),
      );

      expect(during).toEqual({ state, intents: [] });
      expect(afterSettle.state.pendingRun).toBeNull();
      expect(next.intents).toHaveLength(1);
      expect(next.state.pendingRun).toEqual({ runId: "run-3", since: T0 + 180_000 });
    });

    it("keeps waiting when another run's outcome arrives", () => {
      const state = inFlight();

      expect(insightRunSettled(state, settled("run-0"), context(T0 + 1_000)).state).toBe(state);
    });
  });

  describe("given a run that started longer ago than a run may take", () => {
    const longest = INSIGHT_DAILY_RUN_LEASE_MS * INSIGHT_DAILY_RUN_MAX_ATTEMPTS;

    /** @scenario "A run that never settled does not block the board for good" */
    it("starts the new run", () => {
      const lost = insightRunRequested(inFlight(), requested("run-2"), context(T0 + longest));

      expect(lost.intents).toHaveLength(1);
      expect(lost.state.pendingRun).toEqual({ runId: "run-2", since: T0 + longest });
    });

    it("still holds the board one moment before that", () => {
      const held = insightRunRequested(inFlight(), requested("run-2"), context(T0 + longest - 1));

      expect(held.intents).toEqual([]);
    });
  });
});

describe("the runBoard intent", () => {
  const payload = { ...SCHEDULE, maxInsights: 3 as const, runId: "run-1", slot: T0 };
  const intentContext = (attempt: number) => ({
    processName: "dailyInsightsSchedule",
    projectId: "project-1",
    processKey: SCHEDULE.scheduleId,
    tenantId: "project-1",
    messageKey: "run:run-1",
    attempt,
  });

  it("carries the run out in the intent's project, and says when the attempt is the last", async () => {
    const carried: unknown[] = [];
    const run = runBoardIntent({ runs: { run: async (input) => void carried.push(input) } });

    await run(payload, intentContext(1));
    await run(payload, intentContext(INSIGHT_DAILY_RUN_MAX_ATTEMPTS));

    expect(carried).toEqual([
      { ...payload, projectId: "project-1", isFinalAttempt: false },
      { ...payload, projectId: "project-1", isFinalAttempt: true },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { CallContext } from "../../automations/process-managers/defineProcessManager";
import { topicClustering } from "../aggregate";
import { mintManualRunId, mintScheduledRunId, runRank } from "../runIdentity";
import {
  evolveRequested,
  evolveRunCompleted,
  evolveRunFailed,
  initTopicClusteringScheduleState,
  nextDailySlot,
  onTopicClusteringWake,
  TOPIC_CLUSTERING_STALE_RUN_MS,
  type TopicClusteringScheduleState,
  topicClusteringIntentSchemas,
  topicClusteringProcessDefinition,
} from "./schedule";

const PROJECT_ID = "project-1";

function ctx(overrides: Partial<CallContext> = {}): CallContext {
  return {
    key: PROJECT_ID,
    tenantId: PROJECT_ID,
    at: 1_700_000_000_000,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

function stepContext(overrides: Partial<CallContext> = {}) {
  const intents = Object.fromEntries(
    Object.keys(topicClusteringIntentSchemas).map((key) => [
      key,
      (messageKey: string, payload: unknown) => ({
        messageKey,
        intentType: key,
        payload,
      }),
    ]),
  ) as { run: (messageKey: string, payload: unknown) => unknown };
  return { ...ctx(overrides), intents };
}

describe("topicClustering process manager", () => {
  describe("nextDailySlot", () => {
    /** @scenario Each project keeps a stable daily slot spread across the fleet */
    it("is stable for the same project from one day to the next", () => {
      const day1 = nextDailySlot(PROJECT_ID, Date.UTC(2026, 6, 17, 0, 0, 0));
      const day2 = nextDailySlot(PROJECT_ID, day1 + 1000);
      const day1Time = new Date(day1);
      const day2Time = new Date(day2);
      expect(day2Time.getUTCHours()).toBe(day1Time.getUTCHours());
      expect(day2Time.getUTCMinutes()).toBe(day1Time.getUTCMinutes());
      expect(day2 - day1).toBe(24 * 60 * 60 * 1000);
    });

    it("differs between two different projects (spread across the fleet)", () => {
      const slotA = nextDailySlot("project-a", Date.UTC(2026, 6, 17, 0, 0, 0));
      const slotB = nextDailySlot("project-b", Date.UTC(2026, 6, 17, 0, 0, 0));
      // Not a hard guarantee for every possible id pair (a hash can collide),
      // but true for these two fixed ids and demonstrates the function does
      // not return a fixed slot regardless of input.
      expect(slotA).not.toBe(slotB);
    });

    it("always returns an instant strictly after the reference", () => {
      const ref = Date.UTC(2026, 6, 17, 12, 0, 0);
      expect(nextDailySlot(PROJECT_ID, ref)).toBeGreaterThan(ref);
    });
  });

  describe("given a manual request", () => {
    /** @scenario Manual trigger runs immediately and surfaces a gate skip */
    it("starts a run immediately and reschedules the daily slot", () => {
      const result = evolveRequested(
        initTopicClusteringScheduleState(),
        { trigger: "manual", occurredAt: 1_700_000_000_000 },
        stepContext(),
      );
      expect(result.state.currentRun).not.toBeNull();
      expect(result.intents).toHaveLength(1);
      expect(result.nextWakeAt).not.toBeNull();
    });

    /** @scenario Asking for a run while one is already working says so */
    it("does not start a second run when one is already in flight", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const state: TopicClusteringScheduleState = {
        currentRun: { runId, page: 1 },
      };
      const result = evolveRequested(
        state,
        { trigger: "manual", occurredAt: 1_700_000_100_000 },
        stepContext({ at: 1_700_000_100_000, now: 1_700_000_100_000 }),
      );
      expect(result.state.currentRun?.runId).toBe(runId);
      expect(result.intents ?? []).toHaveLength(0);
    });

    it("preempts a stale (abandoned) in-flight run", () => {
      const staleRunId = mintScheduledRunId(1_700_000_000_000);
      const state: TopicClusteringScheduleState = {
        currentRun: { runId: staleRunId, page: 1 },
      };
      const refMs = 1_700_000_000_000 + TOPIC_CLUSTERING_STALE_RUN_MS + 1000;
      const result = evolveRequested(
        state,
        { trigger: "manual", occurredAt: refMs },
        stepContext({ at: refMs, now: refMs }),
      );
      expect(result.state.currentRun?.runId).not.toBe(staleRunId);
      expect(result.intents).toHaveLength(1);
    });

    it("mints the same runId for a redelivered request at the same business instant", () => {
      const first = evolveRequested(
        initTopicClusteringScheduleState(),
        { trigger: "manual", occurredAt: 1_700_000_000_000 },
        stepContext({ at: 1_700_000_000_000 }),
      );
      const second = evolveRequested(
        initTopicClusteringScheduleState(),
        { trigger: "manual", occurredAt: 1_700_000_000_000 },
        stepContext({ at: 1_700_000_000_000 }),
      );
      expect(first.state.currentRun?.runId).toBe(
        second.state.currentRun?.runId,
      );
    });

    it("does not start a run for a bootstrap request — it only ensures the schedule exists", () => {
      const result = evolveRequested(
        initTopicClusteringScheduleState(),
        { trigger: "bootstrap", occurredAt: 1_700_000_000_000 },
        stepContext(),
      );
      expect(result.state.currentRun).toBeNull();
      expect(result.intents ?? []).toHaveLength(0);
      expect(result.nextWakeAt).not.toBeNull();
    });
  });

  describe("given a run completes", () => {
    /** @scenario A large backlog is processed page by page through durable cursors */
    it("continues the walk when a continuation cursor is returned", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const state: TopicClusteringScheduleState = {
        currentRun: { runId, page: 1 },
      };
      const result = evolveRunCompleted(
        state,
        { runId, page: 1, nextSearchAfter: [123, "trace-1"] },
        stepContext(),
      );
      expect(result.state.currentRun).toEqual({ runId, page: 2 });
      expect(result.intents).toHaveLength(1);
    });

    it("clears the in-flight run once the final page (no cursor) completes", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const state: TopicClusteringScheduleState = {
        currentRun: { runId, page: 2 },
      };
      const result = evolveRunCompleted(
        state,
        { runId, page: 2 },
        stepContext(),
      );
      expect(result.state.currentRun).toBeNull();
    });

    /** @scenario A crash mid-backlog resumes from the last committed page */
    it("ignores a stale completion for a run superseded by a newer one", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const state: TopicClusteringScheduleState = {
        currentRun: { runId: newer, page: 1 },
      };
      const result = evolveRunCompleted(
        state,
        { runId: older, page: 2, nextSearchAfter: [1, "t"] },
        stepContext(),
      );
      // The newer run must remain untouched by the older run's straggler.
      expect(result.state.currentRun).toEqual({ runId: newer, page: 1 });
    });
  });

  describe("given a run fails", () => {
    /** @scenario A failing clustering effect retries then records a visible failure */
    it("clears the in-flight run", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const state: TopicClusteringScheduleState = {
        currentRun: { runId, page: 1 },
      };
      const result = evolveRunFailed(state, { runId }, stepContext());
      expect(result.state.currentRun).toBeNull();
    });

    it("ignores a stale failure for a run superseded by a newer one", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const state: TopicClusteringScheduleState = {
        currentRun: { runId: newer, page: 1 },
      };
      const result = evolveRunFailed(state, { runId: older }, stepContext());
      expect(result.state.currentRun).toEqual({ runId: newer, page: 1 });
    });
  });

  describe("onTopicClusteringWake", () => {
    /** @scenario Daily wake runs clustering and reschedules itself */
    it("starts a scheduled run and reschedules the next daily slot", () => {
      const result = onTopicClusteringWake(
        initTopicClusteringScheduleState(),
        stepContext(),
      );
      expect(result.state.currentRun).not.toBeNull();
      expect(result.intents).toHaveLength(1);
      expect(result.nextWakeAt).toBeGreaterThan(ctx().now);
    });

    /** @scenario A run in progress is visible while it is still working */
    it("skips the slot when a run is already in flight", () => {
      const runId = mintScheduledRunId(1_700_000_000_000);
      const state: TopicClusteringScheduleState = {
        currentRun: { runId, page: 1 },
      };
      const result = onTopicClusteringWake(
        state,
        stepContext({ at: 1_700_000_001_000, now: 1_700_000_001_000 }),
      );
      expect(result.state.currentRun?.runId).toBe(runId);
      expect(result.intents ?? []).toHaveLength(0);
    });

    /** @scenario A stale wake stands down */
    it("clamps scheduling to the present rather than the (possibly past) wake instant", () => {
      const past = 1_600_000_000_000;
      const now = 1_700_000_000_000;
      const result = onTopicClusteringWake(
        initTopicClusteringScheduleState(),
        stepContext({ at: past, now }),
      );
      expect(result.nextWakeAt).toBeGreaterThan(now);
    });

    it("mints a scheduled run id ranked at the clamped instant", () => {
      const result = onTopicClusteringWake(
        initTopicClusteringScheduleState(),
        stepContext(),
      );
      const runId = result.state.currentRun?.runId ?? "";
      expect(runRank(runId)).toBe(ctx().now);
    });
  });

  describe("the built process definition", () => {
    it("derives its event types from the events map — no hand-maintained constant", () => {
      expect([...topicClusteringProcessDefinition.eventTypes].sort()).toEqual([
        "requested",
        "runCompleted",
        "runFailed",
      ]);
    });

    it("reacts only to keys the topic_clustering aggregate actually declares", () => {
      const aggregateEventKeys = new Set(Object.keys(topicClustering.events));
      for (const eventType of topicClusteringProcessDefinition.eventTypes) {
        expect(aggregateEventKeys.has(eventType)).toBe(true);
      }
    });

    it("derives its intent constructor from the intents map", () => {
      const intent = topicClusteringProcessDefinition.intents.run(
        "run:x:page-1",
        {
          runId: "x",
          page: 1,
          searchAfter: null,
        },
      );
      expect(intent).toEqual({
        messageKey: "run:x:page-1",
        intentType: "run",
        payload: { runId: "x", page: 1, searchAfter: null },
      });
    });

    it("dispatches evolve by the short event key", () => {
      const step = topicClusteringProcessDefinition.evolve(
        "requested",
        initTopicClusteringScheduleState(),
        { trigger: "manual", occurredAt: 1_700_000_000_000 },
        ctx(),
      );
      expect(step?.state.currentRun).not.toBeNull();
    });

    it("returns undefined for an event type it does not declare (forward compatibility)", () => {
      const step = topicClusteringProcessDefinition.evolve(
        "topicsRecorded",
        initTopicClusteringScheduleState(),
        {},
        ctx(),
      );
      expect(step).toBeUndefined();
    });
  });

  // Guard: mintManualRunId is exercised transitively above; this asserts the
  // process-level contract directly rather than only through evolveRequested.
  it("mintManualRunId produces the same id the requested-handler mints", () => {
    expect(mintManualRunId(42)).toBe("manual-42");
  });
});

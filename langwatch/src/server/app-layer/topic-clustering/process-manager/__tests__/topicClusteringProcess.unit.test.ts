import { describe, expect, it } from "vitest";

import type { TopicClusteringProcessingEvent } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/events";

import {
  nextDailySlot,
  toTopicClusteringProcessEnvelope,
  topicClusteringProcessDefinition,
  TOPIC_CLUSTERING_STALE_RUN_MS,
} from "../topicClusteringProcess.definition";
import type { TopicClusteringProcessState } from "../topicClusteringProcess.types";

const PROJECT_ID = "project-1";
const DAY_MS = 24 * 60 * 60 * 1000;

function makeEvent(overrides: {
  type: TopicClusteringProcessingEvent["type"];
  occurredAt?: number;
  data: unknown;
}): TopicClusteringProcessingEvent {
  return {
    id: `evt-${overrides.type}-${overrides.occurredAt ?? 1}`,
    aggregateId: PROJECT_ID,
    aggregateType: "topic_clustering",
    tenantId: PROJECT_ID,
    createdAt: overrides.occurredAt ?? 1_000,
    occurredAt: overrides.occurredAt ?? 1_000,
    version: "2026-07-17",
    ...overrides,
  } as TopicClusteringProcessingEvent;
}

function evolveEvent(
  previousState: TopicClusteringProcessState,
  event: TopicClusteringProcessingEvent,
) {
  return topicClusteringProcessDefinition.evolve({
    previousState,
    input: { kind: "event", event: toTopicClusteringProcessEnvelope(event) },
  });
}

function evolveWake(
  previousState: TopicClusteringProcessState,
  scheduledFor: number,
) {
  return topicClusteringProcessDefinition.evolve({
    previousState,
    input: { kind: "wake", scheduledFor },
  });
}

function bootstrappedState(): TopicClusteringProcessState {
  return { projectId: PROJECT_ID, enabled: true, currentRun: null };
}

describe("nextDailySlot", () => {
  it("is deterministic and stable across days for one project", () => {
    const first = nextDailySlot(PROJECT_ID, 1_752_700_000_000);
    const dayLater = nextDailySlot(PROJECT_ID, first);
    expect(dayLater - first).toBe(DAY_MS);
  });

  it("is strictly after the reference instant", () => {
    const afterMs = 1_752_700_000_000;
    expect(nextDailySlot(PROJECT_ID, afterMs)).toBeGreaterThan(afterMs);
  });

  it("spreads different projects across different slots", () => {
    const base = 1_752_700_000_000;
    const slots = new Set(
      ["p1", "p2", "p3", "p4", "p5"].map(
        (id) => nextDailySlot(id, base) % DAY_MS,
      ),
    );
    expect(slots.size).toBeGreaterThan(1);
  });
});

describe("topicClusteringProcessDefinition", () => {
  describe("when a bootstrap request arrives", () => {
    it("enables the process and schedules the first wake without an intent", () => {
      const evolution = evolveEvent(
        topicClusteringProcessDefinition.initialState,
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt: 10_000,
          data: { trigger: "bootstrap" },
        }),
      );

      expect(evolution.state.enabled).toBe(true);
      expect(evolution.state.projectId).toBe(PROJECT_ID);
      expect(evolution.intents).toEqual([]);
      expect(evolution.nextWakeAt).toBe(nextDailySlot(PROJECT_ID, 10_000));
    });

    it("is idempotent when re-sent by the backfill task", () => {
      const first = evolveEvent(
        topicClusteringProcessDefinition.initialState,
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt: 10_000,
          data: { trigger: "bootstrap" },
        }),
      );
      const second = evolveEvent(
        first.state,
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt: 11_000,
          data: { trigger: "bootstrap" },
        }),
      );

      expect(second.state).toEqual(first.state);
      expect(second.intents).toEqual([]);
    });
  });

  describe("when the daily wake fires with no run in flight", () => {
    it("emits one run intent for the slot's day and reschedules", () => {
      const scheduledFor = Date.UTC(2026, 6, 17, 9, 30);
      const evolution = evolveWake(bootstrappedState(), scheduledFor);

      expect(evolution.intents).toHaveLength(1);
      expect(evolution.intents[0]).toEqual({
        messageKey: "run:20260717:page-1",
        intentType: "topic_clustering.run",
        payload: { runId: "20260717", page: 1, searchAfter: null },
      });
      expect(evolution.state.currentRun).toEqual({
        runId: "20260717",
        page: 1,
        updatedAtMs: scheduledFor,
      });
      expect(evolution.nextWakeAt).toBe(
        nextDailySlot(PROJECT_ID, scheduledFor),
      );
    });
  });

  describe("when the daily wake fires during an active backlog walk", () => {
    it("skips the slot but keeps the schedule", () => {
      const scheduledFor = Date.UTC(2026, 6, 17, 9, 30);
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: {
          runId: "manual-1",
          page: 3,
          updatedAtMs: scheduledFor - 60_000,
        },
      };

      const evolution = evolveWake(state, scheduledFor);

      expect(evolution.intents).toEqual([]);
      expect(evolution.state.currentRun).toEqual(state.currentRun);
      expect(evolution.nextWakeAt).toBe(
        nextDailySlot(PROJECT_ID, scheduledFor),
      );
    });
  });

  describe("when the daily wake finds a stale abandoned run", () => {
    it("starts a fresh run", () => {
      const scheduledFor = Date.UTC(2026, 6, 17, 9, 30);
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: {
          runId: "20260716",
          page: 2,
          updatedAtMs: scheduledFor - TOPIC_CLUSTERING_STALE_RUN_MS - 1,
        },
      };

      const evolution = evolveWake(state, scheduledFor);

      expect(evolution.intents).toHaveLength(1);
      expect(evolution.state.currentRun?.runId).toBe("20260717");
    });
  });

  describe("when a wake fires for a never-bootstrapped process", () => {
    it("decides nothing and clears its own wake", () => {
      const evolution = evolveWake(
        topicClusteringProcessDefinition.initialState,
        5_000,
      );

      expect(evolution.intents).toEqual([]);
      expect(evolution.nextWakeAt).toBeNull();
    });
  });

  describe("when a manual request arrives while idle", () => {
    it("emits an immediate run intent without disturbing the daily slot", () => {
      const occurredAt = Date.UTC(2026, 6, 17, 14, 0);
      const evolution = evolveEvent(
        bootstrappedState(),
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt,
          data: { trigger: "manual", requestedByUserId: "user-1" },
        }),
      );

      expect(evolution.intents).toEqual([
        {
          messageKey: `run:manual-${occurredAt}:page-1`,
          intentType: "topic_clustering.run",
          payload: { runId: `manual-${occurredAt}`, page: 1, searchAfter: null },
        },
      ]);
      expect(evolution.nextWakeAt).toBe(nextDailySlot(PROJECT_ID, occurredAt));
    });
  });

  describe("when a manual request arrives during an active run", () => {
    it("does not pile a second run onto the project", () => {
      const occurredAt = Date.UTC(2026, 6, 17, 14, 0);
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: { runId: "20260717", page: 1, updatedAtMs: occurredAt - 1 },
      };

      const evolution = evolveEvent(
        state,
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt,
          data: { trigger: "manual" },
        }),
      );

      expect(evolution.intents).toEqual([]);
      expect(evolution.state.currentRun).toEqual(state.currentRun);
    });
  });

  describe("when a page completes with a continuation cursor", () => {
    it("emits the next page intent carrying the cursor", () => {
      const occurredAt = Date.UTC(2026, 6, 17, 10, 0);
      const evolution = evolveEvent(
        {
          ...bootstrappedState(),
          currentRun: { runId: "20260717", page: 1, updatedAtMs: occurredAt - 1 },
        },
        makeEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt,
          data: {
            runId: "20260717",
            page: 1,
            mode: "batch",
            tracesProcessed: 2_000,
            topicsCount: 8,
            subtopicsCount: 20,
            nextSearchAfter: [occurredAt - 5_000, "trace-x"],
          },
        }),
      );

      expect(evolution.intents).toEqual([
        {
          messageKey: "run:20260717:page-2",
          intentType: "topic_clustering.run",
          payload: {
            runId: "20260717",
            page: 2,
            searchAfter: [occurredAt - 5_000, "trace-x"],
          },
        },
      ]);
      expect(evolution.state.currentRun?.page).toBe(2);
    });
  });

  describe("when the final page completes", () => {
    it("clears the in-flight run", () => {
      const occurredAt = Date.UTC(2026, 6, 17, 10, 0);
      const evolution = evolveEvent(
        {
          ...bootstrappedState(),
          currentRun: { runId: "20260717", page: 2, updatedAtMs: occurredAt - 1 },
        },
        makeEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt,
          data: {
            runId: "20260717",
            page: 2,
            mode: "batch",
            tracesProcessed: 300,
            topicsCount: 8,
            subtopicsCount: 20,
          },
        }),
      );

      expect(evolution.intents).toEqual([]);
      expect(evolution.state.currentRun).toBeNull();
    });
  });

  describe("when a run fails after retries", () => {
    it("clears the in-flight run so the next wake can start fresh", () => {
      const occurredAt = Date.UTC(2026, 6, 17, 10, 0);
      const evolution = evolveEvent(
        {
          ...bootstrappedState(),
          currentRun: { runId: "20260717", page: 2, updatedAtMs: occurredAt - 1 },
        },
        makeEvent({
          type: "lw.obs.topic_clustering.run_failed",
          occurredAt,
          data: { runId: "20260717", page: 2, error: "langevals unavailable" },
        }),
      );

      expect(evolution.intents).toEqual([]);
      expect(evolution.state.currentRun).toBeNull();
      expect(evolution.nextWakeAt).toBe(nextDailySlot(PROJECT_ID, occurredAt));
    });
  });
});

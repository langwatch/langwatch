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
  /** Handling instant; defaults to prompt delivery. Pass it to model lag. */
  now?: number,
) {
  const envelope = toTopicClusteringProcessEnvelope(event);
  return topicClusteringProcessDefinition.evolve({
    previousState,
    input: { kind: "event", event: envelope, now: now ?? envelope.occurredAt },
  });
}

function evolveWake(
  previousState: TopicClusteringProcessState,
  scheduledFor: number,
  now: number = scheduledFor,
) {
  return topicClusteringProcessDefinition.evolve({
    previousState,
    input: { kind: "wake", scheduledFor, now },
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
        startedAtMs: scheduledFor,
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

  describe("when wakes were missed for three days", () => {
    it("collapses the gap into exactly one catch-up run", () => {
      // The wake worker drains every due wake it finds; drive that loop.
      const missedSlot = Date.UTC(2026, 6, 14, 9, 30);
      const now = missedSlot + 3 * DAY_MS;

      let state = bootstrappedState();
      let nextWakeAt: number | null = missedSlot;
      const intents = [];
      let iterations = 0;

      while (nextWakeAt !== null && nextWakeAt <= now) {
        if (++iterations > 10) break; // guard against a runaway replay loop
        const evolution = evolveWake(state, nextWakeAt, now);
        state = evolution.state;
        nextWakeAt = evolution.nextWakeAt;
        intents.push(...evolution.intents);
      }

      expect(intents).toHaveLength(1);
      expect(intents[0]!.messageKey).toBe("run:20260717:page-1");
      expect(nextWakeAt).toBeGreaterThan(now);
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

  describe("when a manual request arrives while a stale run is still recorded", () => {
    it("preempts the abandoned run instead of silently dropping the request", () => {
      const occurredAt = Date.UTC(2026, 6, 17, 14, 0);
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: {
          runId: "20260716",
          page: 4,
          updatedAtMs: occurredAt - 60_000,
          startedAtMs: occurredAt - TOPIC_CLUSTERING_STALE_RUN_MS - 1,
        },
      };

      const evolution = evolveEvent(
        state,
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt,
          data: { trigger: "manual", requestedByUserId: "user-1" },
        }),
      );

      // "Run now" against a wedged run used to be a no-op while the route
      // still answered {success:true} and the UI toasted "will start shortly".
      expect(evolution.intents).toEqual([
        {
          messageKey: `run:manual-${occurredAt}:page-1`,
          intentType: "topic_clustering.run",
          payload: { runId: `manual-${occurredAt}`, page: 1, searchAfter: null },
        },
      ]);
      expect(evolution.state.currentRun?.runId).toBe(`manual-${occurredAt}`);
    });
  });

  describe("when an event is delivered long after it occurred", () => {
    it("rearms the wake from the present, never behind it", () => {
      const occurredAt = Date.UTC(2026, 6, 17, 14, 0);
      const now = occurredAt + 3 * DAY_MS;

      const evolution = evolveEvent(
        bootstrappedState(),
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt,
          data: { trigger: "bootstrap" },
        }),
        now,
      );

      // Scheduling from business time put nextWakeAt in the past: the wake
      // fired immediately, regenerated a messageKey the outbox had already
      // dispatched, and skipDuplicates swallowed the insert — leaving
      // currentRun set with nothing in flight and a day of clustering lost.
      expect(evolution.nextWakeAt).toBeGreaterThan(now);
      expect(evolution.nextWakeAt).toBe(nextDailySlot(PROJECT_ID, now));
    });
  });

  describe("when a long backlog walk stalls after making progress", () => {
    it("is abandoned a stale window after it started, not after its last page", () => {
      const scheduledFor = Date.UTC(2026, 6, 17, 9, 30);
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: {
          runId: "20260716",
          page: 7,
          // Paged recently, so the last-page clock still looks healthy...
          updatedAtMs: scheduledFor - 60_000,
          // ...but the run itself began beyond the stale window.
          startedAtMs: scheduledFor - TOPIC_CLUSTERING_STALE_RUN_MS - 1,
        },
      };

      const evolution = evolveWake(state, scheduledFor);

      // Measuring staleness from the last page let a walk refresh its own
      // reprieve every page, deferring the slot and wedging the project for
      // ~48h against ADR-051's documented one-day bound.
      expect(evolution.intents).toHaveLength(1);
      expect(evolution.state.currentRun?.runId).toBe("20260717");
    });
  });

  describe("when a backlog walk is progressing within the stale window", () => {
    it("keeps ownership of the project across pages", () => {
      const scheduledFor = Date.UTC(2026, 6, 17, 9, 30);
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: {
          runId: "20260717",
          page: 7,
          updatedAtMs: scheduledFor - 60_000,
          startedAtMs: scheduledFor - 60 * 60 * 1000,
        },
      };

      const evolution = evolveWake(state, scheduledFor);

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

  describe("when a superseded run's completion arrives late", () => {
    it("ignores it instead of resurrecting the old run over the live one", () => {
      const occurredAt = Date.UTC(2026, 6, 18, 10, 0);
      const liveRun = {
        runId: "20260718",
        page: 1,
        updatedAtMs: occurredAt - 60_000,
      };

      const evolution = evolveEvent(
        { ...bootstrappedState(), currentRun: liveRun },
        makeEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt,
          data: {
            runId: "20260717",
            page: 4,
            mode: "batch",
            tracesProcessed: 2_000,
            topicsCount: 8,
            subtopicsCount: 20,
            nextSearchAfter: [occurredAt - 5_000, "trace-old"],
          },
        }),
      );

      expect(evolution.intents).toEqual([]);
      expect(evolution.state.currentRun).toEqual(liveRun);
    });
  });

  describe("when a superseded run's failure arrives late", () => {
    it("leaves the live run in flight so the next wake does not start a third", () => {
      const occurredAt = Date.UTC(2026, 6, 18, 10, 0);
      const liveRun = {
        runId: "20260718",
        page: 2,
        updatedAtMs: occurredAt - 60_000,
      };

      const evolution = evolveEvent(
        { ...bootstrappedState(), currentRun: liveRun },
        makeEvent({
          type: "lw.obs.topic_clustering.run_failed",
          occurredAt,
          data: {
            runId: "20260717",
            page: 4,
            error: "langevals unavailable",
          },
        }),
      );

      expect(evolution.intents).toEqual([]);
      expect(evolution.state.currentRun).toEqual(liveRun);
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

  describe("when an event is handled long after it occurred", () => {
    it("schedules the next slot ahead of the present, not behind it", () => {
      const occurredAt = Date.UTC(2026, 6, 17, 2, 0);
      // A backed-up subscriber delivers the event a full day late.
      const now = occurredAt + DAY_MS;

      const evolution = evolveEvent(
        bootstrappedState(),
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt,
          data: { trigger: "bootstrap" },
        }),
        now,
      );

      // Scheduling from business time put nextWakeAt in the PAST, which fired
      // an immediate wake whose run intent collided with an already-dispatched
      // messageKey and was dropped, losing a day's clustering with no signal.
      expect(evolution.nextWakeAt).toBe(nextDailySlot(PROJECT_ID, now));
      expect(evolution.nextWakeAt!).toBeGreaterThan(now);
    });
  });

  describe("when a backlog walk stalls hours after starting", () => {
    it("is reclaimed by the next daily wake rather than deferring it a second day", () => {
      const startedAtMs = Date.UTC(2026, 6, 17, 2, 0);
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: {
          runId: "20260717",
          page: 51,
          // Pages flowed for five hours, then the walk died silently.
          updatedAtMs: startedAtMs + 5 * 60 * 60 * 1000,
          startedAtMs,
        },
      };

      const evolution = evolveWake(state, startedAtMs + DAY_MS);

      // Measuring staleness from the last page made this run look fresh at the
      // next slot (19h < 20h), skipping it and wedging the project for 48h.
      expect(evolution.state.currentRun?.runId).toBe("20260718");
      expect(evolution.intents).toHaveLength(1);
    });

    it("keeps deferring while the walk is genuinely young", () => {
      const startedAtMs = Date.UTC(2026, 6, 17, 2, 0);
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: { runId: "20260717", page: 4, updatedAtMs: startedAtMs, startedAtMs },
      };

      const evolution = evolveWake(state, startedAtMs + 60_000);

      expect(evolution.state.currentRun).toEqual(state.currentRun);
      expect(evolution.intents).toEqual([]);
    });
  });

  describe("when a manual request arrives while a stale run is still recorded", () => {
    it("starts a run instead of silently deferring to a dead one", () => {
      const startedAtMs = 1_000_000;
      const occurredAt = startedAtMs + TOPIC_CLUSTERING_STALE_RUN_MS + 1;
      const state: TopicClusteringProcessState = {
        ...bootstrappedState(),
        currentRun: {
          runId: "20260717",
          page: 3,
          updatedAtMs: startedAtMs,
          startedAtMs,
        },
      };

      const evolution = evolveEvent(
        state,
        makeEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt,
          data: { trigger: "manual" },
        }),
      );

      // Deferring here made "Run now" a no-op for as long as the wedge lasted,
      // while the route still reported success back to the user.
      expect(evolution.intents).toHaveLength(1);
      expect(evolution.state.currentRun?.runId).toBe(`manual-${occurredAt}`);
    });

    it("mints the same run id when the request is redelivered late", () => {
      const occurredAt = 5_000_000;
      const event = makeEvent({
        type: "lw.obs.topic_clustering.requested",
        occurredAt,
        data: { trigger: "manual" },
      });

      const prompt = evolveEvent(bootstrappedState(), event, occurredAt);
      const late = evolveEvent(bootstrappedState(), event, occurredAt + DAY_MS);

      // Run identity must come from business time, or a redelivery would mint
      // a second run alongside the first.
      expect(late.state.currentRun?.runId).toBe(prompt.state.currentRun?.runId);
    });
  });
});

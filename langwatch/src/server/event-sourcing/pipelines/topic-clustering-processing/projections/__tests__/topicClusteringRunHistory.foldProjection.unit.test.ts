import { describe, expect, it } from "vitest";

import type { StateProjectionStore } from "../../../../projections/stateProjection.types";
import {
  TOPIC_CLUSTERING_RUN_HISTORY_LIMIT,
  TOPIC_CLUSTERING_RUN_OUTCOME,
} from "../../schemas/constants";
import type {
  TopicClusteringRunCompletedEvent,
  TopicClusteringRunCompletedEventData,
  TopicClusteringRunFailedEvent,
  TopicClusteringRunStartedEvent,
} from "../../schemas/events";
import {
  type TopicClusteringRunHistoryData,
  TopicClusteringRunHistoryFoldProjection,
} from "../topicClusteringRunHistory.foldProjection";

const stubStore = {
  load: async () => null,
  store: async () => undefined,
} as StateProjectionStore<TopicClusteringRunHistoryData>;

const projection = new TopicClusteringRunHistoryFoldProjection({
  store: stubStore,
});

function baseEvent(overrides: {
  type: string;
  occurredAt?: number;
  data: unknown;
}) {
  return {
    id: `evt-${overrides.type}-${overrides.occurredAt ?? 1}`,
    aggregateId: "project-1",
    aggregateType: "topic_clustering",
    tenantId: "project-1",
    createdAt: overrides.occurredAt ?? 1_000,
    occurredAt: overrides.occurredAt ?? 1_000,
    version: "2026-07-19",
    ...overrides,
  };
}

function startedEvent(params: {
  runId: string;
  occurredAt?: number;
}): TopicClusteringRunStartedEvent {
  return baseEvent({
    type: "lw.obs.topic_clustering.run_started",
    occurredAt: params.occurredAt,
    data: { runId: params.runId, page: 1 },
  }) as TopicClusteringRunStartedEvent;
}

function completedEvent(params: {
  occurredAt?: number;
  data?: Partial<TopicClusteringRunCompletedEventData>;
}): TopicClusteringRunCompletedEvent {
  return baseEvent({
    type: "lw.obs.topic_clustering.run_completed",
    occurredAt: params.occurredAt,
    data: {
      runId: "20260720T093000",
      page: 1,
      mode: "batch",
      tracesProcessed: 100,
      topicsCount: 8,
      subtopicsCount: 24,
      ...params.data,
    },
  }) as TopicClusteringRunCompletedEvent;
}

function failedEvent(params: {
  runId: string;
  occurredAt?: number;
}): TopicClusteringRunFailedEvent {
  return baseEvent({
    type: "lw.obs.topic_clustering.run_failed",
    occurredAt: params.occurredAt,
    data: {
      runId: params.runId,
      page: 1,
      error: "raw provider traceback",
      errorCode: "model_not_configured",
      isUserActionable: true,
    },
  }) as TopicClusteringRunFailedEvent;
}

function initState(): TopicClusteringRunHistoryData {
  return { ...projection.init() };
}

describe("TopicClusteringRunHistoryFoldProjection", () => {
  describe("when a run announces its start", () => {
    it("opens a running entry dated from the announcement", () => {
      const state = projection.handleTopicClusteringRunStarted(
        startedEvent({ runId: "20260720T093000", occurredAt: 5_000 }),
        initState(),
      );
      expect(state.Runs).toHaveLength(1);
      expect(state.Runs[0]).toMatchObject({
        runId: "20260720T093000",
        trigger: "scheduled",
        startedAt: 5_000,
        finishedAt: null,
        outcome: TOPIC_CLUSTERING_RUN_OUTCOME.RUNNING,
      });
    });

    it("reads a manual runId as a manual trigger", () => {
      const state = projection.handleTopicClusteringRunStarted(
        startedEvent({ runId: "manual-1752900000000" }),
        initState(),
      );
      expect(state.Runs[0]?.trigger).toBe("manual");
    });

    it("leaves the accumulating entry alone when a later page announces", () => {
      let state = projection.handleTopicClusteringRunStarted(
        startedEvent({ runId: "run-1", occurredAt: 1_000 }),
        initState(),
      );
      state = projection.handleTopicClusteringRunCompleted(
        completedEvent({
          occurredAt: 2_000,
          data: {
            runId: "run-1",
            tracesProcessed: 2_000,
            nextSearchAfter: [123, "trace-a"],
          },
        }),
        state,
      );
      state = projection.handleTopicClusteringRunStarted(
        startedEvent({ runId: "run-1", occurredAt: 3_000 }),
        state,
      );
      expect(state.Runs).toHaveLength(1);
      expect(state.Runs[0]).toMatchObject({
        startedAt: 1_000,
        tracesProcessed: 2_000,
        pages: 1,
      });
    });
  });

  describe("when a run walks its backlog across pages", () => {
    it("accumulates every page into a single entry and settles on the final page", () => {
      let state = projection.handleTopicClusteringRunStarted(
        startedEvent({ runId: "run-1", occurredAt: 1_000 }),
        initState(),
      );
      state = projection.handleTopicClusteringRunCompleted(
        completedEvent({
          occurredAt: 2_000,
          data: {
            runId: "run-1",
            page: 1,
            tracesProcessed: 2_000,
            nextSearchAfter: [123, "trace-a"],
          },
        }),
        state,
      );
      state = projection.handleTopicClusteringRunCompleted(
        completedEvent({
          occurredAt: 3_000,
          data: { runId: "run-1", page: 2, tracesProcessed: 500 },
        }),
        state,
      );
      expect(state.Runs).toHaveLength(1);
      expect(state.Runs[0]).toMatchObject({
        outcome: TOPIC_CLUSTERING_RUN_OUTCOME.COMPLETED,
        finishedAt: 3_000,
        tracesProcessed: 2_500,
        pages: 2,
      });
    });
  });

  describe("when a completion arrives for a run that never announced", () => {
    it("opens and settles the entry dated from the completion", () => {
      const state = projection.handleTopicClusteringRunCompleted(
        completedEvent({ occurredAt: 4_000, data: { runId: "run-lost" } }),
        initState(),
      );
      expect(state.Runs[0]).toMatchObject({
        runId: "run-lost",
        startedAt: 4_000,
        outcome: TOPIC_CLUSTERING_RUN_OUTCOME.COMPLETED,
      });
    });
  });

  describe("when the cadence gate declines the run", () => {
    it("records a skipped entry with its reason", () => {
      const state = projection.handleTopicClusteringRunCompleted(
        completedEvent({
          data: {
            runId: "run-1",
            tracesProcessed: 0,
            topicsCount: 0,
            subtopicsCount: 0,
            skippedReason: "recently_clustered",
          },
        }),
        initState(),
      );
      expect(state.Runs[0]).toMatchObject({
        outcome: TOPIC_CLUSTERING_RUN_OUTCOME.SKIPPED,
        skippedReason: "recently_clustered",
      });
    });
  });

  describe("when a run fails", () => {
    it("keeps the guidance code but never the raw error text or stale counts", () => {
      let state = projection.handleTopicClusteringRunStarted(
        startedEvent({ runId: "run-1", occurredAt: 1_000 }),
        initState(),
      );
      state = projection.handleTopicClusteringRunCompleted(
        completedEvent({
          occurredAt: 2_000,
          data: {
            runId: "run-1",
            tracesProcessed: 2_000,
            nextSearchAfter: [123, "trace-a"],
          },
        }),
        state,
      );
      state = projection.handleTopicClusteringRunFailed(
        failedEvent({ runId: "run-1", occurredAt: 3_000 }),
        state,
      );
      const entry = state.Runs[0]!;
      expect(entry).toMatchObject({
        outcome: TOPIC_CLUSTERING_RUN_OUTCOME.FAILED,
        finishedAt: 3_000,
        errorCode: "model_not_configured",
        isErrorUserActionable: true,
        tracesProcessed: 0,
        pages: 0,
      });
      expect(JSON.stringify(entry)).not.toContain("raw provider traceback");
    });
  });

  describe("when a new run starts while an old one never finished", () => {
    it("settles the superseded run as abandoned", () => {
      let state = projection.handleTopicClusteringRunStarted(
        startedEvent({ runId: "run-old", occurredAt: 1_000 }),
        initState(),
      );
      state = projection.handleTopicClusteringRunStarted(
        startedEvent({ runId: "run-new", occurredAt: 90_000_000 }),
        state,
      );
      expect(state.Runs).toHaveLength(2);
      expect(state.Runs[0]).toMatchObject({
        runId: "run-new",
        outcome: TOPIC_CLUSTERING_RUN_OUTCOME.RUNNING,
      });
      expect(state.Runs[1]).toMatchObject({
        runId: "run-old",
        outcome: TOPIC_CLUSTERING_RUN_OUTCOME.ABANDONED,
        finishedAt: null,
      });
    });
  });

  describe("when more runs finish than the history keeps", () => {
    it("drops the oldest entries past the bound", () => {
      let state = initState();
      const total = TOPIC_CLUSTERING_RUN_HISTORY_LIMIT + 5;
      for (let i = 0; i < total; i++) {
        state = projection.handleTopicClusteringRunCompleted(
          completedEvent({
            occurredAt: 1_000 + i,
            data: { runId: `run-${i}` },
          }),
          state,
        );
      }
      expect(state.Runs).toHaveLength(TOPIC_CLUSTERING_RUN_HISTORY_LIMIT);
      expect(state.Runs[0]?.runId).toBe(`run-${total - 1}`);
      expect(
        state.Runs.some((run) => run.runId === "run-0"),
      ).toBe(false);
    });
  });
});

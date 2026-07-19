import { describe, expect, it } from "vitest";

import type { StateProjectionStore } from "../../../../projections/stateProjection.types";
import type {
  TopicClusteringProcessingEvent,
  TopicClusteringRunCompletedEventData,
} from "../../schemas/events";
import {
  type TopicClusteringRunStatusData,
  TopicClusteringRunStatusFoldProjection,
} from "../topicClusteringRunStatus.foldProjection";

const stubStore = {
  load: async () => null,
  store: async () => undefined,
} as StateProjectionStore<TopicClusteringRunStatusData>;

const projection = new TopicClusteringRunStatusFoldProjection({
  store: stubStore,
});

function baseEvent(overrides: {
  type: TopicClusteringProcessingEvent["type"];
  occurredAt?: number;
  data: unknown;
}): TopicClusteringProcessingEvent {
  return {
    id: `evt-${overrides.type}-${overrides.occurredAt ?? 1}`,
    aggregateId: "project-1",
    aggregateType: "topic_clustering",
    tenantId: "project-1",
    createdAt: overrides.occurredAt ?? 1_000,
    occurredAt: overrides.occurredAt ?? 1_000,
    version: "2026-07-17",
    ...overrides,
  } as TopicClusteringProcessingEvent;
}

function completedData(
  overrides: Partial<TopicClusteringRunCompletedEventData> = {},
): TopicClusteringRunCompletedEventData {
  return {
    runId: "20260717",
    page: 1,
    mode: "batch",
    tracesProcessed: 100,
    topicsCount: 8,
    subtopicsCount: 24,
    ...overrides,
  };
}

function initState(): TopicClusteringRunStatusData {
  return {
    ...projection.init(),
  };
}

describe("TopicClusteringRunStatusFoldProjection", () => {
  describe("when a run starts", () => {
    it("marks the project as having a run in progress", () => {
      const state = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_started",
          data: { runId: "20260717", page: 1 },
        }),
      );

      expect(state.InProgressRunId).toBe("20260717");
    });

    it("shows a single-page run as in progress while it works", () => {
      // The badge used to be set only on the has-next-page branch of
      // run_completed, so a run that finishes in one page — the common case —
      // was never once visible as running.
      const started = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_started",
          data: { runId: "20260717", page: 1 },
        }),
      );
      expect(started.InProgressRunId).toBe("20260717");

      const finished = projection.apply(
        started,
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          data: completedData(),
        }),
      );
      expect(finished.InProgressRunId).toBeNull();
    });

    it("hands over to a new run without carrying the old one's counters", () => {
      const previous = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          data: completedData({ nextSearchAfter: [1, "t"] }),
        }),
      );
      expect(previous.InProgressTraces).toBe(100);

      const superseded = projection.apply(
        previous,
        baseEvent({
          type: "lw.obs.topic_clustering.run_started",
          data: { runId: "20260718", page: 1 },
        }),
      );

      expect(superseded.InProgressRunId).toBe("20260718");
      expect(superseded.InProgressTraces).toBe(0);
      expect(superseded.InProgressPages).toBe(0);
    });
  });

  describe("when a clustering request is recorded", () => {
    it("stamps the request time and trigger", () => {
      const state = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.requested",
          occurredAt: 5_000,
          data: { trigger: "manual", requestedByUserId: "user-1" },
        }),
      );

      expect(state.LastRequestedAt).toBe(5_000);
      expect(state.LastRequestTrigger).toBe("manual");
      expect(state.LastRunAt).toBeNull();
    });
  });

  describe("when a single-page run completes", () => {
    it("records a completed outcome with the run facts", () => {
      const state = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt: 6_000,
          data: completedData(),
        }),
      );

      expect(state.LastRunAt).toBe(6_000);
      expect(state.LastRunOutcome).toBe("completed");
      expect(state.LastRunMode).toBe("batch");
      expect(state.LastRunTracesProcessed).toBe(100);
      expect(state.LastRunTopicsCount).toBe(8);
      expect(state.LastRunPages).toBe(1);
      expect(state.InProgressRunId).toBeNull();
    });
  });

  describe("when a run walks multiple pages", () => {
    it("accumulates in-progress pages and rolls them into the final page", () => {
      let state = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt: 6_000,
          data: completedData({
            page: 1,
            tracesProcessed: 2_000,
            nextSearchAfter: [6_000, "trace-a"],
          }),
        }),
      );

      expect(state.LastRunAt).toBeNull();
      expect(state.InProgressRunId).toBe("20260717");
      expect(state.InProgressTraces).toBe(2_000);
      expect(state.InProgressPages).toBe(1);

      state = projection.apply(
        state,
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt: 7_000,
          data: completedData({ page: 2, tracesProcessed: 500 }),
        }),
      );

      expect(state.LastRunAt).toBe(7_000);
      expect(state.LastRunOutcome).toBe("completed");
      expect(state.LastRunTracesProcessed).toBe(2_500);
      expect(state.LastRunPages).toBe(2);
      expect(state.InProgressRunId).toBeNull();
      expect(state.InProgressTraces).toBe(0);
    });
  });

  describe("when a run is skipped by a gate without processing traces", () => {
    it("records a skipped outcome with the reason", () => {
      const state = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt: 6_000,
          data: completedData({
            tracesProcessed: 0,
            topicsCount: 0,
            subtopicsCount: 0,
            skippedReason: "recently_clustered",
          }),
        }),
      );

      expect(state.LastRunOutcome).toBe("skipped");
      expect(state.LastRunSkippedReason).toBe("recently_clustered");
    });
  });

  describe("when a run fails after retries", () => {
    it("records the failure and clears in-progress accumulation", () => {
      let state = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt: 6_000,
          data: completedData({
            nextSearchAfter: [6_000, "trace-a"],
          }),
        }),
      );

      state = projection.apply(
        state,
        baseEvent({
          type: "lw.obs.topic_clustering.run_failed",
          occurredAt: 8_000,
          data: { runId: "20260717", page: 2, error: "langevals unavailable" },
        }),
      );

      expect(state.LastRunOutcome).toBe("failed");
      expect(state.LastRunError).toBe("langevals unavailable");
      expect(state.LastRunAt).toBe(8_000);
      expect(state.InProgressRunId).toBeNull();
    });
  });

  describe("when a run fails after an earlier run succeeded", () => {
    it("clears the previous run's counts instead of reporting them as the failed run's", () => {
      // A fully successful run lands real counts on the row.
      let state = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt: 1_000,
          data: completedData({
            tracesProcessed: 12_000,
            topicsCount: 40,
            subtopicsCount: 120,
          }),
        }),
      );
      expect(state.LastRunTracesProcessed).toBe(12_000);

      // The NEXT run fails outright. Its counts are unknown, so the row must
      // not keep advertising the previous run's successes next to "failed" —
      // that renders a failure beside a healthy-looking 12,000 traces.
      state = projection.apply(
        state,
        baseEvent({
          type: "lw.obs.topic_clustering.run_failed",
          occurredAt: 2_000,
          data: { runId: "20260718", page: 1, error: "langevals unavailable" },
        }),
      );

      expect(state.LastRunOutcome).toBe("failed");
      expect(state.LastRunTracesProcessed).toBe(0);
      expect(state.LastRunTopicsCount).toBe(0);
      expect(state.LastRunSubtopicsCount).toBe(0);
      expect(state.LastRunPages).toBe(0);
    });

    it("clears the previous run's mode rather than attributing it to the failure", () => {
      let state = projection.apply(
        initState(),
        baseEvent({
          type: "lw.obs.topic_clustering.run_completed",
          occurredAt: 1_000,
          data: completedData({ mode: "batch" }),
        }),
      );
      expect(state.LastRunMode).toBe("batch");

      state = projection.apply(
        state,
        baseEvent({
          type: "lw.obs.topic_clustering.run_failed",
          occurredAt: 2_000,
          data: { runId: "20260718", page: 1, error: "langevals unavailable" },
        }),
      );

      // Keeping it made the settings page say "Rebuilt all topics" about a run
      // that clustered nothing.
      expect(state.LastRunMode).toBeNull();
    });
  });
});

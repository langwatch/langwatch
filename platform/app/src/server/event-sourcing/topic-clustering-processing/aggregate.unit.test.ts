import { describe, expect, it } from "vitest";
import {
  recordClusteringRunCompletedIdempotencyKey,
  recordClusteringRunFailedIdempotencyKey,
  recordClusteringRunStartedIdempotencyKey,
  recordTopicsIdempotencyKey,
  requestClusteringIdempotencyKey,
  topicClustering,
} from "./aggregate";

describe("topicClustering aggregate", () => {
  describe("given events are declared", () => {
    it("derives the dotted type strings already in the event log", () => {
      expect([...topicClustering.eventTypes].sort()).toEqual([
        "lw.obs.topic_clustering.requested",
        "lw.obs.topic_clustering.run_completed",
        "lw.obs.topic_clustering.run_failed",
        "lw.obs.topic_clustering.run_started",
        "lw.obs.topic_clustering.topics_recorded",
      ]);
    });

    it("creates events carrying that type string and the given payload", () => {
      const data = {
        projectId: "project-1",
        runId: "run-1",
        page: 1,
        occurredAt: 1700000000000,
      };
      expect(topicClustering.events.runStarted(data)).toEqual({
        type: "lw.obs.topic_clustering.run_started",
        data,
      });
    });

    it("extracts the aggregate id from any event's payload — one stream per project", () => {
      expect(
        topicClustering.id({
          projectId: "project-1",
          trigger: "manual",
          occurredAt: 1700000000000,
        }),
      ).toBe("project-1");
    });

    it("leaves state untouched for a type it was not built with", () => {
      const state = topicClustering.init();
      expect(
        topicClustering.apply(state, {
          type: "lw.obs.topic_clustering.added_later",
          data: {},
        }),
      ).toEqual(state);
    });
  });

  describe("given commands are declared", () => {
    it("requestClustering emits a requested event carrying its input verbatim", () => {
      const input = {
        projectId: "project-1",
        trigger: "manual" as const,
        occurredAt: 1700000000000,
      };
      expect(
        topicClustering.commands.requestClustering.handle(
          topicClustering.init(),
          input,
          topicClustering.events,
        ),
      ).toEqual([topicClustering.events.requested(input)]);
    });

    it("recordTopics emits a topicsRecorded event carrying its input verbatim", () => {
      const input = {
        projectId: "project-1",
        mode: "replace" as const,
        source: "clustering" as const,
        dedupeKey: "run:run-1:page-1",
        topics: [],
        occurredAt: 1700000000000,
      };
      expect(
        topicClustering.commands.recordTopics.handle(
          topicClustering.init(),
          input,
          topicClustering.events,
        ),
      ).toEqual([topicClustering.events.topicsRecorded(input)]);
    });
  });

  describe("command idempotency keys", () => {
    /**
     * Two calls asserting the identical fact must produce the identical key, so
     * a redelivery collapses in `event_log` rather than appending a permanent
     * duplicate.
     * @scenario A redelivered trace assignment collapses to one recorded event
     */
    it("requestClustering: two bootstrap requests always collapse to the same key", () => {
      expect(
        requestClusteringIdempotencyKey({
          trigger: "bootstrap",
          occurredAt: 1700000000000,
        }),
      ).toBe(
        requestClusteringIdempotencyKey({
          trigger: "bootstrap",
          occurredAt: 1700086400000,
        }),
      );
    });

    it("requestClustering: two manual requests at different instants get different keys", () => {
      expect(
        requestClusteringIdempotencyKey({
          trigger: "manual",
          occurredAt: 1700000000000,
        }),
      ).not.toBe(
        requestClusteringIdempotencyKey({
          trigger: "manual",
          occurredAt: 1700000005000,
        }),
      );
    });

    it("recordClusteringRunStarted: redelivering the same page collapses", () => {
      const key = { runId: "run-1", page: 2 };
      expect(recordClusteringRunStartedIdempotencyKey(key)).toBe(
        recordClusteringRunStartedIdempotencyKey({ ...key }),
      );
    });

    it("recordClusteringRunStarted: a different page never collapses with another", () => {
      expect(
        recordClusteringRunStartedIdempotencyKey({ runId: "run-1", page: 1 }),
      ).not.toBe(
        recordClusteringRunStartedIdempotencyKey({ runId: "run-1", page: 2 }),
      );
    });

    it("recordClusteringRunCompleted: keyed by run and page, not by outcome fields", () => {
      const key = { runId: "run-1", page: 1 };
      expect(recordClusteringRunCompletedIdempotencyKey(key)).toBe(
        recordClusteringRunCompletedIdempotencyKey({ ...key }),
      );
    });

    it("recordClusteringRunFailed: redelivering the same failure collapses", () => {
      const key = { runId: "run-1", page: 1 };
      expect(recordClusteringRunFailedIdempotencyKey(key)).toBe(
        recordClusteringRunFailedIdempotencyKey({ ...key }),
      );
    });

    it("recordTopics: keyed by the caller's dedupeKey, not by topic content", () => {
      expect(recordTopicsIdempotencyKey({ dedupeKey: "seed:v1" })).toBe(
        recordTopicsIdempotencyKey({ dedupeKey: "seed:v1" }),
      );
      expect(
        recordTopicsIdempotencyKey({ dedupeKey: "run:run-1:page-1" }),
      ).not.toBe(recordTopicsIdempotencyKey({ dedupeKey: "seed:v1" }));
    });

    it("keys never carry a redundant tenantId prefix — event_log's sort key already scopes it", () => {
      expect(recordTopicsIdempotencyKey({ dedupeKey: "seed:v1" })).not.toMatch(
        /tenant/i,
      );
    });
  });
});

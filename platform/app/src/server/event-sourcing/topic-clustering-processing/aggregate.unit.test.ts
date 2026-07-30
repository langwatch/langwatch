import { describe, expect, it } from "vitest";
import {
  recordClusteringRunCompletedIdempotencyKey,
  recordClusteringRunFailedIdempotencyKey,
  recordClusteringRunStartedIdempotencyKey,
  recordTopicsIdempotencyKey,
  requestClusteringIdempotencyKey,
  topicClustering,
  topicClusteringAggregateId,
  topicClusteringEventKeyOf,
} from "./aggregate";

describe("topicClustering aggregate", () => {
  describe("given events are declared", () => {
    it("derives a type string per event, qualified by the aggregate", () => {
      expect([...topicClustering.eventTypes].sort()).toEqual([
        "topic_clustering/requested",
        "topic_clustering/runCompleted",
        "topic_clustering/runFailed",
        "topic_clustering/runStarted",
        "topic_clustering/topicsRecorded",
      ]);
    });

    it("creates events carrying the qualified type string and the given payload", () => {
      const event = topicClustering.events.runStarted({
        runId: "run-1",
        page: 1,
        occurredAt: 1700000000000,
      });
      expect(event).toEqual({
        type: "topic_clustering/runStarted",
        data: { runId: "run-1", page: 1, occurredAt: 1700000000000 },
      });
    });

    it("leaves state untouched for a type it was not built with", () => {
      const state = topicClustering.init();
      expect(
        topicClustering.apply(state, {
          type: "topic_clustering/added_later",
          data: {},
        }),
      ).toEqual(state);
    });
  });

  describe("given commands are declared", () => {
    it("requestClustering emits a requested event carrying its input verbatim", () => {
      const input = { trigger: "manual" as const, occurredAt: 1700000000000 };
      const emitted = topicClustering.commands.requestClustering.handle(
        topicClustering.init(),
        input,
        topicClustering.events,
      );
      expect(emitted).toEqual([topicClustering.events.requested(input)]);
    });

    it("recordTopics emits a topicsRecorded event carrying its input verbatim", () => {
      const input = {
        mode: "replace" as const,
        source: "clustering" as const,
        dedupeKey: "run:run-1:page-1",
        topics: [],
        occurredAt: 1700000000000,
      };
      const emitted = topicClustering.commands.recordTopics.handle(
        topicClustering.init(),
        input,
        topicClustering.events,
      );
      expect(emitted).toEqual([topicClustering.events.topicsRecorded(input)]);
    });
  });

  describe("topicClusteringAggregateId", () => {
    it("is the project id — one clustering stream per project", () => {
      expect(topicClusteringAggregateId({ tenantId: "project-1" })).toBe(
        "project-1",
      );
    });
  });

  describe("topicClusteringEventKeyOf", () => {
    it("recovers the short event key from a full derived type string", () => {
      expect(topicClusteringEventKeyOf("topic_clustering/requested")).toBe(
        "requested",
      );
      expect(topicClusteringEventKeyOf("topic_clustering/runCompleted")).toBe(
        "runCompleted",
      );
    });

    it("returns undefined for a type string from a different aggregate", () => {
      expect(topicClusteringEventKeyOf("trace/spanRecorded")).toBeUndefined();
    });

    it("round-trips every declared event type back to its own key", () => {
      for (const type of topicClustering.eventTypes) {
        const key = topicClusteringEventKeyOf(type);
        expect(key).toBeDefined();
        expect(`${topicClustering.name}/${key}`).toBe(type);
      }
    });
  });

  describe("command idempotency keys", () => {
    /**
     *      * Bound here rather than on `AssignTopicCommand` itself (out of scope —
     * a different aggregate, `trace`, in a different pipeline directory) to
     * pin the SAME property on every command in THIS aggregate: two calls
     * asserting the identical fact must produce the identical key, so a
     * redelivery collapses in `event_log` instead of appending a permanent
     * duplicate the way the unfixed `AssignTopicCommand` once did.
     */
    /** @scenario A redelivered trace assignment collapses to one recorded event */
    it("requestClustering: two bootstrap requests always collapse to the same key", () => {
      const first = requestClusteringIdempotencyKey({
        trigger: "bootstrap",
        occurredAt: 1700000000000,
      });
      const second = requestClusteringIdempotencyKey({
        trigger: "bootstrap",
        occurredAt: 1700086400000,
      });
      expect(first).toBe(second);
    });

    it("requestClustering: two manual requests at different instants get different keys", () => {
      const first = requestClusteringIdempotencyKey({
        trigger: "manual",
        occurredAt: 1700000000000,
      });
      const second = requestClusteringIdempotencyKey({
        trigger: "manual",
        occurredAt: 1700000005000,
      });
      expect(first).not.toBe(second);
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

    it("keys never carry a redundant tenantId prefix — event_log's own sort key already scopes it", () => {
      expect(recordTopicsIdempotencyKey({ dedupeKey: "seed:v1" })).not.toMatch(
        /tenant/i,
      );
    });
  });
});

/**
 * Idempotency contract for AssignTopicCommand.
 *
 * `AssignTopicCommand` emitted its TopicAssignedEvent with no
 * `idempotencyKey`, so `eventToRecord` fell back to `IdempotencyKey: event.id`
 * — a fresh KSUID per delivery. `event_log` is
 * `ReplacingMergeTree(EventTimestamp)` ordered by
 * `(TenantId, AggregateType, AggregateId, IdempotencyKey)`, so a redelivered
 * assignment landed under a brand-new sort key and was never collapsed by a
 * merge: a permanent duplicate row, plus a redundant trace-fold pass.
 *
 * The trace folds apply topic assignment as a pure overwrite
 * (`topicId: event.data.topicId ?? state.topicId`), so a duplicate never
 * corrupted state — this is write amplification, not count corruption.
 *
 * These tests drive the real redelivery path (calling `handle` twice with the
 * same command) and observe the duplicate through the real store helpers
 * (`deduplicateEvents` / `eventToRecord`) rather than asserting a key string.
 */

import { describe, expect, it } from "vitest";
import { type Command, createTenantId } from "../../../../";
import {
  deduplicateEvents,
  eventToRecord,
} from "../../../../stores/eventStoreUtils";
import type { AssignTopicCommandData } from "../../schemas/commands";
import { ASSIGN_TOPIC_COMMAND_TYPE } from "../../schemas/constants";
import { AssignTopicCommand } from "../assignTopicCommand";

const TENANT_ID = "tenant-001";
const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";

function makeCommand({
  topicId = "topic-a",
  subtopicId = "subtopic-a",
  occurredAt = 1700000000000,
}: {
  topicId?: string | null;
  subtopicId?: string | null;
  occurredAt?: number;
} = {}): Command<AssignTopicCommandData> {
  return {
    type: ASSIGN_TOPIC_COMMAND_TYPE,
    aggregateId: TRACE_ID,
    tenantId: createTenantId(TENANT_ID),
    data: {
      tenantId: TENANT_ID,
      traceId: TRACE_ID,
      topicId,
      topicName: topicId ? `name-of-${topicId}` : null,
      subtopicId,
      subtopicName: subtopicId ? `name-of-${subtopicId}` : null,
      isIncremental: false,
      occurredAt,
    },
  };
}

describe("AssignTopicCommand", () => {
  describe("given the same topic assignment is delivered twice", () => {
    describe("when both deliveries reach the event store", () => {
      /** @scenario "A redelivered trace assignment collapses to one recorded event" */
      it("collapses the redelivery onto a single event_log identity", async () => {
        const command = new AssignTopicCommand();

        // The caller stamps `occurredAt` with `Date.now()` per clustering run
        // (app-layer/topic-clustering/clustering.ts), so a daily pass
        // re-asserting the same trace→topic fact never repeats it. Varying it
        // here is what pins the key to the ASSIGNMENT rather than the delivery:
        // including occurredAt would mint a fresh sort key every run and append
        // to `event_log` forever.
        const [first] = await command.handle(
          makeCommand({ occurredAt: 1700000000000 }),
        );
        const [second] = await command.handle(
          makeCommand({ occurredAt: 1700086400000 }),
        );

        // Guard: a redelivery really does mint a fresh event id, so the
        // collapse below cannot pass via EventId dedup alone.
        expect(first!.id).not.toBe(second!.id);

        // The ReplacingMergeTree sort key must match, or the duplicate row
        // survives every merge.
        expect(eventToRecord(first!).IdempotencyKey).toBe(
          eventToRecord(second!).IdempotencyKey,
        );

        expect(deduplicateEvents([first!, second!])).toHaveLength(1);
      });
    });
  });

  describe("given the trace is re-assigned to a different topic", () => {
    describe("when both assignments reach the event store", () => {
      /** @scenario "Re-assigning a trace to a different topic records a new event" */
      it("keeps the later assignment as its own event", async () => {
        const command = new AssignTopicCommand();

        const [original] = await command.handle(
          makeCommand({ topicId: "topic-a", subtopicId: "subtopic-a" }),
        );
        const [retopiced] = await command.handle(
          makeCommand({ topicId: "topic-b", subtopicId: "subtopic-b" }),
        );

        expect(eventToRecord(original!).IdempotencyKey).not.toBe(
          eventToRecord(retopiced!).IdempotencyKey,
        );

        expect(deduplicateEvents([original!, retopiced!])).toHaveLength(2);
      });

      /** @scenario "Re-assigning a trace to a different subtopic records a new event" */
      it("distinguishes a subtopic-only change from a redelivery", async () => {
        const command = new AssignTopicCommand();

        const [original] = await command.handle(
          makeCommand({ topicId: "topic-a", subtopicId: "subtopic-a" }),
        );
        const [resubtopiced] = await command.handle(
          makeCommand({ topicId: "topic-a", subtopicId: "subtopic-b" }),
        );

        expect(deduplicateEvents([original!, resubtopiced!])).toHaveLength(2);
      });
    });
  });

  describe("given a trace assignment that clears the topic", () => {
    describe("when the clearing command is redelivered", () => {
      /** @scenario "A redelivered trace assignment collapses to one recorded event" */
      it("collapses a null-topic redelivery too", async () => {
        const command = new AssignTopicCommand();

        const [first] = await command.handle(
          makeCommand({ topicId: null, subtopicId: null }),
        );
        const [second] = await command.handle(
          makeCommand({ topicId: null, subtopicId: null }),
        );

        expect(first!.id).not.toBe(second!.id);
        expect(deduplicateEvents([first!, second!])).toHaveLength(1);
      });
    });
  });
});

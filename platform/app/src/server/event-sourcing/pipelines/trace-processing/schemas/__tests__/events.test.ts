import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
} from "../constants";
import {
  isSpanReceivedEvent,
  isTopicAssignedEvent,
  parseSpanReferencedPayload,
  topicAssignedEventDataSchema,
  topicAssignedEventSchema,
} from "../events";

describe("events schemas", () => {
  describe("spanReferencedPayloadSchema", () => {
    describe("when a job staged under the previous wire shape arrives", () => {
      /**
       * The schema is a plain DTO now (no longer an EventSchema extension),
       * but the bytes on the queue are a contract with jobs staged by earlier
       * builds. This fixture is deliberately ALL literals — no shared
       * constants — so any drift in the wire strings or the envelope fields
       * fails here rather than on a live queue mid-rollout.
       */
      const pinnedWireJob = () => ({
        id: "evt-wire-ref",
        aggregateId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        aggregateType: "trace",
        tenantId: "tenant-1",
        createdAt: 1_000,
        occurredAt: 1_000,
        type: "lw.obs.trace.span_referenced",
        version: "2026-07-24",
        data: {
          traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
          spanId: "0011223344556677",
          spanName: "claude_code.tool",
          startTimeUnixMs: 1_000,
        },
      });

      it("round-trips the pinned literal fixture through the parse unchanged", () => {
        expect(parseSpanReferencedPayload(pinnedWireJob())).toEqual(
          pinnedWireJob(),
        );
      });

      it("returns null for any other staged type so callers fall through", () => {
        expect(
          parseSpanReferencedPayload({
            ...pinnedWireJob(),
            type: "lw.obs.trace.span_received",
          }),
        ).toBeNull();
      });
    });
  });

  describe("topicAssignedEventDataSchema", () => {
    it("validates complete topic assignment data", () => {
      const data = {
        topicId: "topic-123",
        topicName: "Customer Support",
        subtopicId: "subtopic-456",
        subtopicName: "Billing Questions",
        isIncremental: true,
      };

      const result = topicAssignedEventDataSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.topicId).toBe("topic-123");
        expect(result.data.topicName).toBe("Customer Support");
        expect(result.data.subtopicId).toBe("subtopic-456");
        expect(result.data.subtopicName).toBe("Billing Questions");
        expect(result.data.isIncremental).toBe(true);
      }
    });

    it("validates topic assignment with null values", () => {
      const data = {
        topicId: null,
        topicName: null,
        subtopicId: null,
        subtopicName: null,
        isIncremental: false,
      };

      const result = topicAssignedEventDataSchema.safeParse(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.topicId).toBeNull();
        expect(result.data.subtopicId).toBeNull();
      }
    });

    it("rejects data with missing isIncremental field", () => {
      const data = {
        topicId: "topic-123",
        topicName: "Customer Support",
        subtopicId: null,
        subtopicName: null,
      };

      const result = topicAssignedEventDataSchema.safeParse(data);

      expect(result.success).toBe(false);
    });
  });

  describe("topicAssignedEventSchema", () => {
    it("validates complete topic assigned event", () => {
      const event = {
        id: "event-123",
        aggregateId: "trace-456",
        aggregateType: "trace",
        tenantId: createTenantId("project_abc123"),
        type: TOPIC_ASSIGNED_EVENT_TYPE,
        version: "2025-02-01",
        createdAt: Date.now(),
        occurredAt: Date.now(),
        data: {
          topicId: "topic-123",
          topicName: "Customer Support",
          subtopicId: "subtopic-456",
          subtopicName: "Billing Questions",
          isIncremental: true,
        },
        metadata: {},
      };

      const result = topicAssignedEventSchema.safeParse(event);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TOPIC_ASSIGNED_EVENT_TYPE);
        expect(result.data.data.topicId).toBe("topic-123");
      }
    });

    it("validates event with optional metadata", () => {
      const event = {
        id: "event-123",
        aggregateId: "trace-456",
        aggregateType: "trace",
        tenantId: createTenantId("project_abc123"),
        type: TOPIC_ASSIGNED_EVENT_TYPE,
        version: "2025-02-01",
        createdAt: Date.now(),
        occurredAt: Date.now(),
        data: {
          topicId: "topic-123",
          topicName: "Customer Support",
          subtopicId: null,
          subtopicName: null,
          isIncremental: false,
        },
        metadata: {
          processingTraceparent: "00-abc123-def456-01",
        },
      };

      const result = topicAssignedEventSchema.safeParse(event);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.processingTraceparent).toBe(
          "00-abc123-def456-01",
        );
      }
    });
  });

  describe("isTopicAssignedEvent type guard", () => {
    it("returns true for TopicAssignedEvent", () => {
      const event = {
        id: "event-123",
        aggregateId: "trace-456",
        aggregateType: "trace" as const,
        tenantId: createTenantId("project_abc123"),
        type: TOPIC_ASSIGNED_EVENT_TYPE,
        version: "2025-02-01",
        createdAt: Date.now(),
        occurredAt: Date.now(),
        data: {
          topicId: "topic-123",
          topicName: "Customer Support",
          subtopicId: null,
          subtopicName: null,
          isIncremental: false,
        },
        metadata: {},
      };

      expect(isTopicAssignedEvent(event)).toBe(true);
    });

    it("returns false for SpanReceivedEvent type", () => {
      // We only check the type field, not the full event structure
      const event = {
        type: SPAN_RECEIVED_EVENT_TYPE,
      } as Parameters<typeof isTopicAssignedEvent>[0];

      expect(isTopicAssignedEvent(event)).toBe(false);
    });
  });

  describe("isSpanReceivedEvent type guard", () => {
    it("returns true for SpanReceivedEvent type", () => {
      const event = {
        type: SPAN_RECEIVED_EVENT_TYPE,
      } as Parameters<typeof isSpanReceivedEvent>[0];

      expect(isSpanReceivedEvent(event)).toBe(true);
    });

    it("returns false for TopicAssignedEvent", () => {
      const event = {
        id: "event-123",
        aggregateId: "trace-456",
        aggregateType: "trace" as const,
        tenantId: createTenantId("project_abc123"),
        type: TOPIC_ASSIGNED_EVENT_TYPE,
        version: "2025-02-01",
        createdAt: Date.now(),
        occurredAt: Date.now(),
        data: {
          topicId: "topic-123",
          topicName: "Customer Support",
          subtopicId: null,
          subtopicName: null,
          isIncremental: false,
        },
        metadata: {},
      };

      expect(isSpanReceivedEvent(event)).toBe(false);
    });
  });
});

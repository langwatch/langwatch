import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import {
	SPAN_RECEIVED_EVENT_TYPE,
	TOPIC_ASSIGNED_EVENT_TYPE,
} from "../constants";
import {
	isSpanReceivedEvent,
	isTopicAssignedEvent,
	topicAssignedEventDataSchema,
	topicAssignedEventSchema,
} from "../events";

describe("events schemas", () => {
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
        timestamp: Date.now(),
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
        timestamp: Date.now(),
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
        timestamp: Date.now(),
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
        timestamp: Date.now(),
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

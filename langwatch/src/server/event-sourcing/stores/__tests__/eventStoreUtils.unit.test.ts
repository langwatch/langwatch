import { describe, expect, it } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import { createTenantId } from "../../domain/tenantId";
import { EVENT_TYPES } from "../../domain/eventType";
import {
  deduplicateEvents,
  eventToRecord,
  recordToEvent,
} from "../eventStoreUtils";
import type { EventRecord } from "../repositories/eventRepository.types";

const tenantId = createTenantId("test-tenant");
const aggregateId = "test-aggregate";
const aggregateType: AggregateType = "trace";
const eventType = EVENT_TYPES[0];
const eventVersion = "2025-12-17";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: `event_${Math.random().toString(36).slice(2)}`,
    aggregateId,
    aggregateType,
    tenantId,
    createdAt: 1000,
    occurredAt: 1000,
    type: eventType,
    version: eventVersion,
    data: {},
    ...overrides,
  };
}

describe("deduplicateEvents", () => {
  describe("when events have duplicate EventIds", () => {
    it("keeps first occurrence", () => {
      const e1 = makeEvent({ id: "dup", data: { v: 1 } });
      const e2 = makeEvent({ id: "dup", data: { v: 2 } });
      const result = deduplicateEvents([e1, e2]);
      expect(result).toHaveLength(1);
      expect(result[0]?.data).toEqual({ v: 1 });
    });
  });

  describe("when events have duplicate idempotencyKeys", () => {
    it("keeps first occurrence even with different EventIds", () => {
      const e1 = makeEvent({
        id: "event_a",
        idempotencyKey: "t:trace1:span1",
        data: { v: 1 },
      });
      const e2 = makeEvent({
        id: "event_b",
        idempotencyKey: "t:trace1:span1",
        data: { v: 2 },
      });
      const result = deduplicateEvents([e1, e2]);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("event_a");
    });
  });

  describe("when events have no idempotencyKey (legacy)", () => {
    it("deduplicates only by EventId", () => {
      const e1 = makeEvent({ id: "same", data: { v: 1 } });
      const e2 = makeEvent({ id: "same", data: { v: 2 } });
      const e3 = makeEvent({ id: "different", data: { v: 3 } });
      const result = deduplicateEvents([e1, e2, e3]);
      expect(result).toHaveLength(2);
      expect(result.map((e) => e.id)).toEqual(["same", "different"]);
    });
  });

  describe("when mixing legacy and keyed events", () => {
    it("handles both dedup strategies", () => {
      const legacy1 = makeEvent({ id: "dup_id", data: { v: 1 } });
      const legacy2 = makeEvent({ id: "dup_id", data: { v: 2 } });
      const keyed1 = makeEvent({
        id: "event_x",
        idempotencyKey: "key1",
        data: { v: 3 },
      });
      const keyed2 = makeEvent({
        id: "event_y",
        idempotencyKey: "key1",
        data: { v: 4 },
      });
      const unique = makeEvent({ id: "event_z", data: { v: 5 } });

      const result = deduplicateEvents([
        legacy1,
        legacy2,
        keyed1,
        keyed2,
        unique,
      ]);
      expect(result).toHaveLength(3);
      expect(result.map((e) => e.id)).toEqual(["dup_id", "event_x", "event_z"]);
    });
  });
});

describe("eventToRecord", () => {
  describe("when event has idempotencyKey", () => {
    it("maps to IdempotencyKey field", () => {
      const event = makeEvent({ idempotencyKey: "t:trace1:span1" });
      const record = eventToRecord(event);
      expect(record.IdempotencyKey).toBe("t:trace1:span1");
    });
  });

  describe("when event has no idempotencyKey", () => {
    it("defaults IdempotencyKey to EventId for RMT uniqueness", () => {
      const event = makeEvent({ id: "event_abc123" });
      const record = eventToRecord(event);
      expect(record.IdempotencyKey).toBe("event_abc123");
    });
  });
});

describe("recordToEvent", () => {
  describe("when record has non-empty IdempotencyKey", () => {
    it("maps to idempotencyKey field", () => {
      const record: EventRecord = {
        TenantId: String(tenantId),
        AggregateType: aggregateType,
        AggregateId: aggregateId,
        EventId: "event_123",
        EventTimestamp: 1000,
        EventOccurredAt: 1000,
        EventType: eventType,
        EventVersion: eventVersion,
        EventPayload: {},
        ProcessingTraceparent: "",
        IdempotencyKey: "t:trace1:span1",
      };
      const event = recordToEvent(record, aggregateId);
      expect(event.idempotencyKey).toBe("t:trace1:span1");
    });
  });

  describe("when record has empty IdempotencyKey", () => {
    it("omits idempotencyKey from event", () => {
      const record: EventRecord = {
        TenantId: String(tenantId),
        AggregateType: aggregateType,
        AggregateId: aggregateId,
        EventId: "event_123",
        EventTimestamp: 1000,
        EventOccurredAt: 1000,
        EventType: eventType,
        EventVersion: eventVersion,
        EventPayload: {},
        ProcessingTraceparent: "",
        IdempotencyKey: "",
      };
      const event = recordToEvent(record, aggregateId);
      expect(event.idempotencyKey).toBeUndefined();
    });
  });
});

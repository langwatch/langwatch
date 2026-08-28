import { beforeEach, describe, expect, it } from "vitest";
import { type AggregateType, EventUtils } from "../../";
import { createTenantId } from "../../domain/tenantId";
import { TEST_EVENT_TYPES } from "../../services/__tests__/testHelpers";
import { EventStoreMemory } from "../eventStoreMemory";

describe("EventStoreMemory - Event ID Deduplication", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const aggregateType: AggregateType = "trace";
  const eventType = TEST_EVENT_TYPES[0];
  const eventVersion = "2025-12-17";

  let store: EventStoreMemory;

  beforeEach(() => {
    store = EventStoreMemory.createForTesting();
  });

  describe("getEvent", () => {
    it("loads one event only inside its tenant-bound aggregate stream", async () => {
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: "expected" },
        createdAt: 1_000,
      });
      await store.storeEvents([event], { tenantId }, aggregateType);

      const loaded = await store.getEvent({
        eventId: event.id,
        tenantId,
        aggregateType,
        aggregateId,
      });

      expect(loaded).toEqual(event);
    });

    it("does not load an event from another tenant with the same immutable id", async () => {
      const otherTenantId = createTenantId("other-tenant");
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId: otherTenantId,
        type: eventType,
        version: eventVersion,
        data: { value: "other tenant" },
        createdAt: 1_000,
      });
      await store.storeEvents([event], { tenantId: otherTenantId }, aggregateType);

      await expect(
        store.getEvent({
          eventId: event.id,
          tenantId,
          aggregateType,
          aggregateId,
        }),
      ).rejects.toMatchObject({ name: "EventNotFoundError" });
    });

    it("does not load an event from a different aggregate in the same tenant", async () => {
      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId: "other-trace",
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: "other aggregate" },
        createdAt: 1_000,
      });
      await store.storeEvents([event], { tenantId }, aggregateType);

      await expect(
        store.getEvent({
          eventId: event.id,
          tenantId,
          aggregateType,
          aggregateId,
        }),
      ).rejects.toMatchObject({ name: "EventNotFoundError" });
    });
  });

  describe("getEvents - deduplication", () => {
    it("returns deduplicated events (same Event ID appears once)", async () => {
      const context = { tenantId };
      const timestamp = 1000;

      // Create two events with same Event ID (same timestamp/tenant/aggregate/type)
      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 1 },
        createdAt: timestamp,
      });

      // Manually create event2 with same Event ID
      const event2 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 2 },
          createdAt: timestamp,
        }),
        id: event1.id, // Same Event ID
      };

      // Store both events
      await store.storeEvents([event1], context, aggregateType);
      await store.storeEvents([event2], context, aggregateType);

      // Get events - should return only one (first occurrence)
      const retrieved = await store.getEvents(aggregateId, context, aggregateType);

      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.id).toBe(event1.id);
      // Should keep the first one (earlier timestamp)
      expect(retrieved[0]?.createdAt).toBe(timestamp);
    });

    it("keeps first occurrence when duplicates exist", async () => {
      const context = { tenantId };
      const timestamp = 1000;

      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: "first" },
        createdAt: timestamp,
      });

      // Create events with same Event ID
      const event2 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: "second" },
          createdAt: timestamp,
        }),
        id: event1.id,
      };

      const event3 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: "third" },
          createdAt: timestamp,
        }),
        id: event1.id,
      };

      // Store all events
      await store.storeEvents([event1, event2, event3], context, aggregateType);

      const retrieved = await store.getEvents(aggregateId, context, aggregateType);

      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.data).toEqual({ value: "first" });
      expect(retrieved[0]?.createdAt).toBe(timestamp);
    });

    it("sorts events by timestamp before deduplication", async () => {
      const context = { tenantId };
      const timestamp = 1000; // Same createdAt for all events

      // Create events with same timestamp (same Event ID)
      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 1 },
        createdAt: timestamp,
      });

      const event2 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 2 },
          createdAt: timestamp,
        }),
        id: event1.id, // Same Event ID
      };

      const event3 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 3 },
          createdAt: timestamp,
        }),
        id: event1.id, // Same Event ID
      };

      // Store in order - first one should be kept
      await store.storeEvents([event1, event2, event3], context, aggregateType);

      const retrieved = await store.getEvents(aggregateId, context, aggregateType);

      // Should keep the first one when sorted (earliest timestamp, first in array)
      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.createdAt).toBe(timestamp);
      expect(retrieved[0]?.data).toEqual({ value: 1 });
    });

    it("allows events with different Event IDs", async () => {
      const context = { tenantId };

      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 1 },
        createdAt: 1000,
      });

      const event2 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 2 },
        createdAt: 2000, // Different createdAt = different Event ID
      });

      await store.storeEvents([event1, event2], context, aggregateType);

      const retrieved = await store.getEvents(aggregateId, context, aggregateType);

      expect(retrieved.length).toBe(2);
      expect(retrieved.map((e) => e.id).sort()).toEqual([event1.id, event2.id].sort());
    });
  });

  describe("storeEvents - deduplication", () => {
    it("skips inserts if Event ID already exists", async () => {
      const context = { tenantId };
      const timestamp = 1000;

      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 1 },
        createdAt: timestamp,
      });

      // Create event2 with same Event ID
      const event2 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 2 },
          createdAt: timestamp,
        }),
        id: event1.id, // Same Event ID
      };

      // Store first event
      await store.storeEvents([event1], context, aggregateType);

      // Try to store second event with same Event ID
      await store.storeEvents([event2], context, aggregateType);

      // Should only have one event
      const retrieved = await store.getEvents(aggregateId, context, aggregateType);
      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.data).toEqual({ value: 1 });
    });

    it("allows storing events with different Event IDs", async () => {
      const context = { tenantId };

      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 1 },
        createdAt: 1000,
      });

      const event2 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 2 },
        createdAt: 2000, // Different createdAt = different Event ID
      });

      await store.storeEvents([event1], context, aggregateType);
      await store.storeEvents([event2], context, aggregateType);

      const retrieved = await store.getEvents(aggregateId, context, aggregateType);
      expect(retrieved.length).toBe(2);
    });
  });

  describe("recordToEvent - backward compatibility", () => {
    it("falls back occurredAt to timestamp when EventOccurredAt is 0 (old event)", async () => {
      const context = { tenantId };
      const timestamp = 5000;

      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 1 },
        createdAt: timestamp,
      });

      // Store the event normally
      await store.storeEvents([event], context, aggregateType);

      // Manually insert a second event with EventOccurredAt=0 to simulate old data
      const oldEvent = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 2 },
        createdAt: 6000,
      });
      // Access the repository directly to insert a record with EventOccurredAt=0
      const repo = (store as any).repository;
      await repo.insertEventRecords([
        {
          TenantId: String(tenantId),
          AggregateType: aggregateType,
          AggregateId: aggregateId,
          EventId: oldEvent.id,
          EventTimestamp: 6000,
          EventOccurredAt: 0,
          EventType: eventType,
          EventVersion: eventVersion,
          EventPayload: { value: 2 },
          ProcessingTraceparent: "",
          IdempotencyKey: "",
        },
      ]);

      const retrieved = await store.getEvents(aggregateId, context, aggregateType);

      // The old event (EventOccurredAt=0) should fall back to its timestamp
      const oldRetrieved = retrieved.find((e) => e.id === oldEvent.id);
      expect(oldRetrieved).toBeDefined();
      expect(oldRetrieved!.occurredAt).toBe(6000); // Falls back to timestamp, not 0
    });
  });
});

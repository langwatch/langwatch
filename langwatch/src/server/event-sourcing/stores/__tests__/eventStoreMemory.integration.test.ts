import { beforeEach, describe, expect, it } from "vitest";
import { type AggregateType, EventUtils } from "../../";
import { EVENT_TYPES } from "../../domain/eventType";
import { createTenantId } from "../../domain/tenantId";
import { EventStoreMemory } from "../eventStoreMemory";
import { EventRepositoryMemory } from "../repositories/eventRepositoryMemory";

describe("EventStoreMemory - Event ID Deduplication", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const aggregateType: AggregateType = "trace";
  const eventType = EVENT_TYPES[0];
  const eventVersion = "2025-12-17";

  let store: EventStoreMemory;

  beforeEach(() => {
    store = new EventStoreMemory(new EventRepositoryMemory());
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
        timestamp,
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
          timestamp,
        }),
        id: event1.id, // Same Event ID
      };

      // Store both events
      await store.storeEvents([event1], context, aggregateType);
      await store.storeEvents([event2], context, aggregateType);

      // Get events - should return only one (first occurrence)
      const retrieved = await store.getEvents(
        aggregateId,
        context,
        aggregateType,
      );

      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.id).toBe(event1.id);
      // Should keep the first one (earlier timestamp)
      expect(retrieved[0]?.timestamp).toBe(timestamp);
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
        timestamp,
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
          timestamp,
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
          timestamp,
        }),
        id: event1.id,
      };

      // Store all events
      await store.storeEvents([event1, event2, event3], context, aggregateType);

      const retrieved = await store.getEvents(
        aggregateId,
        context,
        aggregateType,
      );

      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.data).toEqual({ value: "first" });
      expect(retrieved[0]?.timestamp).toBe(timestamp);
    });

    it("sorts events by timestamp before deduplication", async () => {
      const context = { tenantId };
      const timestamp = 1000; // Same timestamp for all events

      // Create events with same timestamp (same Event ID)
      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 1 },
        timestamp,
      });

      const event2 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 2 },
          timestamp,
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
          timestamp,
        }),
        id: event1.id, // Same Event ID
      };

      // Store in order - first one should be kept
      await store.storeEvents([event1, event2, event3], context, aggregateType);

      const retrieved = await store.getEvents(
        aggregateId,
        context,
        aggregateType,
      );

      // Should keep the first one when sorted (earliest timestamp, first in array)
      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.timestamp).toBe(timestamp);
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
        timestamp: 1000,
      });

      const event2 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 2 },
        timestamp: 2000, // Different timestamp = different Event ID
      });

      await store.storeEvents([event1, event2], context, aggregateType);

      const retrieved = await store.getEvents(
        aggregateId,
        context,
        aggregateType,
      );

      expect(retrieved.length).toBe(2);
      expect(retrieved.map((e) => e.id).sort()).toEqual(
        [event1.id, event2.id].sort(),
      );
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
        timestamp,
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
          timestamp,
        }),
        id: event1.id, // Same Event ID
      };

      // Store first event
      await store.storeEvents([event1], context, aggregateType);

      // Try to store second event with same Event ID
      await store.storeEvents([event2], context, aggregateType);

      // Should only have one event
      const retrieved = await store.getEvents(
        aggregateId,
        context,
        aggregateType,
      );
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
        timestamp: 1000,
      });

      const event2 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 2 },
        timestamp: 2000, // Different timestamp = different Event ID
      });

      await store.storeEvents([event1], context, aggregateType);
      await store.storeEvents([event2], context, aggregateType);

      const retrieved = await store.getEvents(
        aggregateId,
        context,
        aggregateType,
      );
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
        timestamp,
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
        timestamp: 6000,
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
        },
      ]);

      const retrieved = await store.getEvents(
        aggregateId,
        context,
        aggregateType,
      );

      // The old event (EventOccurredAt=0) should fall back to its timestamp
      const oldRetrieved = retrieved.find((e) => e.id === oldEvent.id);
      expect(oldRetrieved).toBeDefined();
      expect(oldRetrieved!.occurredAt).toBe(6000); // Falls back to timestamp, not 0
    });
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { EventStoreMemory } from "../eventStoreMemory";
import { EventRepositoryMemory } from "../repositories/eventRepositoryMemory";
import { EventUtils, type AggregateType } from "../../../library";
import { createTenantId } from "../../../library/domain/tenantId";
import { EVENT_TYPES } from "../../../library/domain/eventType";

describe("EventStoreMemory - Event ID Deduplication", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const aggregateType: AggregateType = "span_ingestion";
  const eventType = EVENT_TYPES[0];

  let store: EventStoreMemory;

  beforeEach(() => {
    store = new EventStoreMemory(new EventRepositoryMemory());
  });

  describe("getEvents - deduplication", () => {
    it("returns deduplicated events (same Event ID appears once)", async () => {
      const context = { tenantId };
      const timestamp = 1000;

      // Create two events with same Event ID (same timestamp/tenant/aggregate/type)
      const event1 = EventUtils.createEvent(

        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { value: 1 },
        void 0,
        timestamp,
      );

      // Manually create event2 with same Event ID
      const event2 = {
        ...EventUtils.createEvent(

          aggregateType,
          aggregateId,
          tenantId,
          eventType,
          { value: 2 },
          void 0,
          timestamp,
        ),
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
      expect(retrieved[0]?.timestamp).toBe(timestamp);
    });

    it("keeps first occurrence when duplicates exist", async () => {
      const context = { tenantId };
      const timestamp = 1000;

      const event1 = EventUtils.createEvent(

        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { value: "first" },
        void 0,
        timestamp,
      );

      // Create events with same Event ID
      const event2 = {
        ...EventUtils.createEvent(

          aggregateType,
          aggregateId,
          tenantId,
          eventType,
          { value: "second" },
          void 0,
          timestamp,
        ),
        id: event1.id,
      };

      const event3 = {
        ...EventUtils.createEvent(

          aggregateType,
          aggregateId,
          tenantId,
          eventType,
          { value: "third" },
          void 0,
          timestamp,
        ),
        id: event1.id,
      };

      // Store all events
      await store.storeEvents([event1, event2, event3], context, aggregateType);

      const retrieved = await store.getEvents(aggregateId, context, aggregateType);

      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.data).toEqual({ value: "first" });
      expect(retrieved[0]?.timestamp).toBe(timestamp);
    });

    it("sorts events by timestamp before deduplication", async () => {
      const context = { tenantId };
      const timestamp = 1000; // Same timestamp for all events

      // Create events with same timestamp (same Event ID)
      const event1 = EventUtils.createEvent(

        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { value: 1 },
        void 0,
        timestamp,
      );

      const event2 = {
        ...EventUtils.createEvent(

          aggregateType,
          aggregateId,
          tenantId,
          eventType,
          { value: 2 },
          void 0,
          timestamp,
        ),
        id: event1.id, // Same Event ID
      };

      const event3 = {
        ...EventUtils.createEvent(

          aggregateType,
          aggregateId,
          tenantId,
          eventType,
          { value: 3 },
          void 0,
          timestamp,
        ),
        id: event1.id, // Same Event ID
      };

      // Store in order - first one should be kept
      await store.storeEvents([event1, event2, event3], context, aggregateType);

      const retrieved = await store.getEvents(aggregateId, context, aggregateType);

      // Should keep the first one when sorted (earliest timestamp, first in array)
      expect(retrieved.length).toBe(1);
      expect(retrieved[0]?.timestamp).toBe(timestamp);
      expect(retrieved[0]?.data).toEqual({ value: 1 });
    });

    it("allows events with different Event IDs", async () => {
      const context = { tenantId };

      const event1 = EventUtils.createEvent(

        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { value: 1 },
        void 0,
        1000,
      );

      const event2 = EventUtils.createEvent(

        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { value: 2 },
        void 0,
        2000, // Different timestamp = different Event ID
      );

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

      const event1 = EventUtils.createEvent(

        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { value: 1 },
        void 0,
        timestamp,
      );

      // Create event2 with same Event ID
      const event2 = {
        ...EventUtils.createEvent(

          aggregateType,
          aggregateId,
          tenantId,
          eventType,
          { value: 2 },
          void 0,
          timestamp,
        ),
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

      const event1 = EventUtils.createEvent(

        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { value: 1 },
        void 0,
        1000,
      );

      const event2 = EventUtils.createEvent(

        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        { value: 2 },
        void 0,
        2000, // Different timestamp = different Event ID
      );

      await store.storeEvents([event1], context, aggregateType);
      await store.storeEvents([event2], context, aggregateType);

      const retrieved = await store.getEvents(aggregateId, context, aggregateType);
      expect(retrieved.length).toBe(2);
    });
  });
});


import { beforeEach, describe, expect, it } from "vitest";
import { type AggregateType, EventUtils } from "../../";
import { EVENT_TYPES } from "../../domain/eventType";
import { createTenantId } from "../../domain/tenantId";
import { EventStoreMemory } from "../eventStoreMemory";
import { EventRepositoryMemory } from "../repositories/eventRepositoryMemory";

describe("EventStoreMemory - countEventsBefore", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const aggregateType: AggregateType = "trace";
  const eventType = EVENT_TYPES[0];
  const eventVersion = "2025-12-17";

  let store: EventStoreMemory;

  beforeEach(() => {
    store = new EventStoreMemory(new EventRepositoryMemory());
  });

  describe("counts events before a specific timestamp correctly", () => {
    it("returns 0 for first event in aggregate", async () => {
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

      await store.storeEvents([event1], context, aggregateType);

      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        timestamp,
        event1.id,
      );

      expect(count).toBe(0);
    });

    it("counts events with earlier timestamps", async () => {
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
        timestamp: 2000,
      });
      const event3 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 3 },
        timestamp: 3000,
      });

      await store.storeEvents([event1, event2, event3], context, aggregateType);

      // Count events before event2 (timestamp 2000)
      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        2000,
        event2.id,
      );

      // Should count event1 (timestamp 1000 < 2000)
      expect(count).toBe(1);
    });

    it("counts events with same timestamp but earlier ID", async () => {
      const context = { tenantId };
      const sameTimestamp = 1000;

      // Create events with same timestamp but different IDs (sorted by ID)
      // Manually set IDs to ensure predictable ordering (event IDs now include KSUID)
      const event1 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 1 },
          timestamp: sameTimestamp,
        }),
        id: `${sameTimestamp}:${tenantId}:${aggregateId}:${aggregateType}:a`, // Earliest ID
      };
      // Manually create event2 with same timestamp but later ID
      const event2 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 2 },
          timestamp: sameTimestamp,
        }),
        id: `${sameTimestamp}:${tenantId}:${aggregateId}:${aggregateType}:b`, // Later ID
      };
      const event3 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 3 },
          timestamp: sameTimestamp,
        }),
        id: `${sameTimestamp}:${tenantId}:${aggregateId}:${aggregateType}:c`, // Latest ID
      };

      await store.storeEvents([event1, event2, event3], context, aggregateType);

      // Count events before event2 (same timestamp, but ID comparison)
      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        sameTimestamp,
        event2.id,
      );

      // Should count event1 (same timestamp but earlier ID)
      expect(count).toBe(1);
    });

    it("handles empty event sets", async () => {
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "non-existent-event";

      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        timestamp,
        eventId,
      );

      expect(count).toBe(0);
    });

    it("enforces tenant isolation", async () => {
      const tenantId1 = createTenantId("tenant-1");
      const tenantId2 = createTenantId("tenant-2");
      const context1 = { tenantId: tenantId1 };
      const context2 = { tenantId: tenantId2 };

      const event1 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId: tenantId1,
        type: eventType,
        version: eventVersion,
        data: { value: 1 },
        timestamp: 1000,
      });
      const event2 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId: tenantId2,
        type: eventType,
        version: eventVersion,
        data: { value: 2 },
        timestamp: 1000,
      });

      await store.storeEvents([event1], context1, aggregateType);
      await store.storeEvents([event2], context2, aggregateType);

      // Count events before event2 in tenant2's context
      const count = await store.countEventsBefore(
        aggregateId,
        context2,
        aggregateType,
        1000,
        event2.id,
      );

      // Should only count events from tenant2 (0, since event2 is the first)
      expect(count).toBe(0);
    });

    it("validates tenant context before querying", async () => {
      const invalidContext = {} as any;

      await expect(
        store.countEventsBefore(
          aggregateId,
          invalidContext,
          aggregateType,
          1000,
          "event-id",
        ),
      ).rejects.toThrow("tenantId");
    });

    it("handles events with identical timestamps and different IDs", async () => {
      const context = { tenantId };
      const sameTimestamp = 1000;

      // Create events with same timestamp, IDs determine order
      // Manually set IDs to ensure predictable ordering (event IDs now include KSUID)
      const event1 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 1 },
          timestamp: sameTimestamp,
        }),
        id: `${sameTimestamp}:${tenantId}:${aggregateId}:${aggregateType}:a`, // Earliest ID
      };
      const event2 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 2 },
          timestamp: sameTimestamp,
        }),
        id: `${sameTimestamp}:${tenantId}:${aggregateId}:${aggregateType}:b`,
      };
      const event3 = {
        ...EventUtils.createEvent({
          aggregateType,
          aggregateId,
          tenantId,
          type: eventType,
          version: eventVersion,
          data: { value: 3 },
          timestamp: sameTimestamp,
        }),
        id: `${sameTimestamp}:${tenantId}:${aggregateId}:${aggregateType}:c`,
      };

      await store.storeEvents([event1, event2, event3], context, aggregateType);

      // Count events before event3
      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        sameTimestamp,
        event3.id,
      );

      // Should count event1 and event2 (both have same timestamp but earlier IDs)
      // Note: All events now have manually set IDs to ensure predictable ordering
      expect(count).toBe(2);
    });

    it("counts correctly when events have mixed timestamps", async () => {
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
        timestamp: 2000,
      });
      const event3 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 3 },
        timestamp: 2000, // Same timestamp as event2
      });
      // Manually set different IDs to prevent deduplication (since they have same timestamp)
      event2.id = `${event2.id}-event2`;
      event3.id = `${event3.id}-event3`;
      const event4 = EventUtils.createEvent({
        aggregateType,
        aggregateId,
        tenantId,
        type: eventType,
        version: eventVersion,
        data: { value: 4 },
        timestamp: 3000,
      });

      await store.storeEvents(
        [event1, event2, event3, event4],
        context,
        aggregateType,
      );

      // Count events before event4 (timestamp 3000)
      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        3000,
        event4.id,
      );

      // Should count event1, event2, event3 (all have timestamp < 3000)
      expect(count).toBe(3);
    });
  });
});

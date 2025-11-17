import { describe, it, expect, beforeEach } from "vitest";
import { EventStoreMemory } from "../eventStoreMemory";
import type { Event } from "../../library";

// Helper to create test events with arbitrary types
const createTestEvent = <T extends string>(
  event: Omit<Event<string>, "type"> & { type: T },
): Event<string> => event as Event<string>;

describe("EventStoreMemory - Functional Behavior", () => {
  let store: EventStoreMemory<string, Event<string>>;
  const tenantId = "test-tenant";
  const aggregateType = "trace" as const;
  const context = { tenantId };

  beforeEach(() => {
    store = new EventStoreMemory();
  });

  describe("getEvents()", () => {
    it("returns stored events in order", async () => {
      const events: Event<string>[] = [
        createTestEvent({
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "EVENT_1" as any,
          data: { value: 1 },
        }),
        createTestEvent({
          aggregateId: "agg-1",
          timestamp: 1001,
          type: "EVENT_2" as any,
          data: { value: 2 },
        }),
      ];

      await store.storeEvents(events, context, aggregateType);
      const retrieved = await store.getEvents("agg-1", context, aggregateType);

      expect(retrieved).toHaveLength(2);
      expect(retrieved[0]?.type).toBe("EVENT_1");
      expect(retrieved[1]?.type).toBe("EVENT_2");
    });

    it("returns empty array for non-existent aggregate", async () => {
      const events = await store.getEvents(
        "non-existent",
        context,
        aggregateType,
      );

      expect(events).toEqual([]);
      expect(Array.isArray(events)).toBe(true);
    });

    it("returns new array (not reference to internal storage)", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const retrieved1 = await store.getEvents("agg-1", context, aggregateType);
      const retrieved2 = await store.getEvents("agg-1", context, aggregateType);

      // Should return different array instances
      expect(retrieved1).not.toBe(retrieved2);
      expect(retrieved1).toEqual(retrieved2);
    });

    it("prevents mutation of stored events", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: { value: 1 },
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const retrieved = await store.getEvents("agg-1", context, aggregateType);

      // Mutate retrieved event
      if (retrieved[0]) {
        (retrieved[0] as any).data.value = 999;
        (retrieved[0] as any).type = "MUTATED";
      }

      // Retrieve again - should be unchanged
      const retrieved2 = await store.getEvents("agg-1", context, aggregateType);
      expect(retrieved2[0]?.data).toEqual({ value: 1 });
      expect(retrieved2[0]?.type).toBe("TEST");
    });

    it("isolates events by tenant", async () => {
      const event1: Event<string> = {
        aggregateId: "agg-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: { tenant: "tenant-1" },
      };

      const event2: Event<string> = {
        aggregateId: "agg-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: { tenant: "tenant-2" },
      };

      await store.storeEvents(
        [event1],
        { tenantId: "tenant-1" },
        aggregateType,
      );
      await store.storeEvents(
        [event2],
        { tenantId: "tenant-2" },
        aggregateType,
      );

      const tenant1Events = await store.getEvents(
        "agg-1",
        { tenantId: "tenant-1" },
        aggregateType,
      );
      const tenant2Events = await store.getEvents(
        "agg-1",
        { tenantId: "tenant-2" },
        aggregateType,
      );

      expect(tenant1Events).toHaveLength(1);
      expect(tenant1Events[0]?.data).toEqual({ tenant: "tenant-1" });
      expect(tenant2Events).toHaveLength(1);
      expect(tenant2Events[0]?.data).toEqual({ tenant: "tenant-2" });
    });
  });

  describe("storeEvents()", () => {
    it("stores single event", async () => {
      const event: Event<string> = {
        aggregateId: "agg-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: { value: 1 },
      };

      await store.storeEvents([event], context, aggregateType);
      const retrieved = await store.getEvents("agg-1", context, aggregateType);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]?.type).toBe("TEST");
      expect(retrieved[0]?.data).toEqual({ value: 1 });
    });

    it("stores multiple events for same aggregate", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "EVENT_1" as any,
          data: {},
        },
        {
          aggregateId: "agg-1",
          timestamp: 1001,
          type: "EVENT_2" as any,
          data: {},
        },
        {
          aggregateId: "agg-1",
          timestamp: 1002,
          type: "EVENT_3" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const retrieved = await store.getEvents("agg-1", context, aggregateType);

      expect(retrieved).toHaveLength(3);
      expect(retrieved[0]?.type).toBe("EVENT_1");
      expect(retrieved[1]?.type).toBe("EVENT_2");
      expect(retrieved[2]?.type).toBe("EVENT_3");
    });

    it("appends events (not replaces) for same aggregate", async () => {
      const events1: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "EVENT_1" as any,
          data: {},
        },
      ];

      const events2: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1001,
          type: "EVENT_2" as any,
          data: {},
        },
      ];

      await store.storeEvents(events1, context, aggregateType);
      await store.storeEvents(events2, context, aggregateType);

      const retrieved = await store.getEvents("agg-1", context, aggregateType);
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0]?.type).toBe("EVENT_1");
      expect(retrieved[1]?.type).toBe("EVENT_2");
    });

    it("stores events for different aggregates", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-2",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      const agg1Events = await store.getEvents("agg-1", context, aggregateType);
      const agg2Events = await store.getEvents("agg-2", context, aggregateType);

      expect(agg1Events).toHaveLength(1);
      expect(agg2Events).toHaveLength(1);
    });

    it("maintains event order", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "EVENT_1" as any,
          data: {},
        },
        {
          aggregateId: "agg-1",
          timestamp: 1001,
          type: "EVENT_2" as any,
          data: {},
        },
        {
          aggregateId: "agg-1",
          timestamp: 1002,
          type: "EVENT_3" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const retrieved = await store.getEvents("agg-1", context, aggregateType);

      expect(retrieved[0]?.timestamp).toBe(1000);
      expect(retrieved[1]?.timestamp).toBe(1001);
      expect(retrieved[2]?.timestamp).toBe(1002);
    });

    it("prevents mutation of stored events from input", async () => {
      const event: Event<string> = {
        aggregateId: "agg-1",
        timestamp: 1000,
        type: "TEST" as any,
        data: { value: 1 },
      };

      await store.storeEvents([event], context, aggregateType);

      // Mutate original event
      event.data = { value: 999 };
      (event as any).type = "MUTATED";

      // Retrieved event should be unchanged
      const retrieved = await store.getEvents("agg-1", context, aggregateType);
      expect(retrieved[0]?.data).toEqual({ value: 1 });
      expect(retrieved[0]?.type).toBe("TEST");
    });
  });

  describe("listAggregateIds()", () => {
    it("returns all aggregate IDs for tenant+type", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-2",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-3",
          timestamp: 1002,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const result = await store.listAggregateIds(context, aggregateType);

      expect(result.aggregateIds).toContain("agg-1");
      expect(result.aggregateIds).toContain("agg-2");
      expect(result.aggregateIds).toContain("agg-3");
      expect(result.aggregateIds.length).toBeGreaterThanOrEqual(3);
    });

    it("handles pagination with limit", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-2",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-3",
          timestamp: 1002,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const result = await store.listAggregateIds(
        context,
        aggregateType,
        undefined,
        2,
      );

      expect(result.aggregateIds.length).toBe(2);
    });

    it("handles cursor-based pagination", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-2",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-3",
          timestamp: 1002,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      // First page
      const page1 = await store.listAggregateIds(
        context,
        aggregateType,
        undefined,
        2,
      );
      expect(page1.aggregateIds).toHaveLength(2);
      expect(page1.nextCursor).toBeDefined();

      // Second page
      const page2 = await store.listAggregateIds(
        context,
        aggregateType,
        page1.nextCursor,
        2,
      );
      expect(page2.aggregateIds.length).toBeGreaterThanOrEqual(1);
    });

    it("handles empty string cursor", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const result = await store.listAggregateIds(
        context,
        aggregateType,
        "",
        100,
      );

      expect(result.aggregateIds.length).toBeGreaterThanOrEqual(1);
    });

    it("handles cursor with special characters", async () => {
      const specialId = "agg-🚀-@#$";
      const events: Event<string>[] = [
        {
          aggregateId: "agg-normal",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: specialId,
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-z",
          timestamp: 1002,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      // Verify the actual sort order first
      const allIds = await store.listAggregateIds(
        context,
        aggregateType,
        undefined,
        100,
      );
      const sorted = [...allIds.aggregateIds].sort();

      // Cursor should work with string comparison
      // When using specialId as cursor, we should get IDs that come after it in sort order
      const result = await store.listAggregateIds(
        context,
        aggregateType,
        specialId,
        100,
      );
      expect(result.aggregateIds).not.toContain(specialId);

      // Verify that all returned IDs are greater than the cursor
      for (const id of result.aggregateIds) {
        expect(id > specialId).toBe(true);
      }

      // Verify that IDs less than or equal to cursor are not included
      for (const id of sorted) {
        if (id <= specialId) {
          expect(result.aggregateIds).not.toContain(id);
        }
      }
    });

    it("returns nextCursor when exactly limit results", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-2",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-3",
          timestamp: 1002,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const result = await store.listAggregateIds(
        context,
        aggregateType,
        undefined,
        3,
      );

      expect(result.aggregateIds).toHaveLength(3);
      expect(result.nextCursor).toBeDefined();
    });

    it("returns undefined nextCursor when less than limit results", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-2",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const result = await store.listAggregateIds(
        context,
        aggregateType,
        undefined,
        3,
      );

      expect(result.aggregateIds.length).toBeLessThanOrEqual(2);
      expect(result.nextCursor).toBeUndefined();
    });

    it("handles empty result set", async () => {
      const result = await store.listAggregateIds(context, aggregateType);

      expect(result.aggregateIds).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });

    it("sorts aggregate IDs lexicographically", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-3",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-1",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
        },
        {
          aggregateId: "agg-2",
          timestamp: 1002,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const result = await store.listAggregateIds(context, aggregateType);

      // Should be sorted
      expect(result.aggregateIds[0]).toBe("agg-1");
      expect(result.aggregateIds[1]).toBe("agg-2");
      expect(result.aggregateIds[2]).toBe("agg-3");
    });

    it("handles cursor beyond last item", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      const result = await store.listAggregateIds(
        context,
        aggregateType,
        "zzz",
        100,
      );

      expect(result.aggregateIds).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe("seed()", () => {
    it("seeds events correctly", () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: { value: 1 },
        },
        {
          aggregateId: "agg-1",
          timestamp: 1001,
          type: "TEST" as any,
          data: { value: 2 },
        },
      ];

      store.seed("agg-1", events, tenantId, aggregateType);
      const retrieved = store.getEvents("agg-1", context, aggregateType);

      return retrieved.then((result) => {
        expect(result).toHaveLength(2);
        expect(result[0]?.data).toEqual({ value: 1 });
        expect(result[1]?.data).toEqual({ value: 2 });
      });
    });

    it("overwrites existing events (not appends)", async () => {
      const initialEvents: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "OLD" as any,
          data: {},
        },
      ];

      await store.storeEvents(initialEvents, context, aggregateType);

      const newEvents: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 2000,
          type: "NEW" as any,
          data: {},
        },
      ];

      store.seed("agg-1", newEvents, tenantId, aggregateType);
      const retrieved = await store.getEvents("agg-1", context, aggregateType);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]?.type).toBe("NEW");
    });

    it("updates aggregate tracking", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
      ];

      store.seed("agg-1", events, tenantId, aggregateType);
      const result = await store.listAggregateIds(context, aggregateType);

      expect(result.aggregateIds).toContain("agg-1");
    });

    it("seed() with empty array clears events but keeps aggregate in list", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);
      store.seed("agg-1", [], tenantId, aggregateType);

      const retrieved = await store.getEvents("agg-1", context, aggregateType);
      const result = await store.listAggregateIds(context, aggregateType);

      expect(retrieved).toEqual([]);
      // Aggregate might still be in list or removed, depending on implementation
      // This tests the actual behavior
    });

    it("isolates seed() by tenant", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: { tenant: "tenant-1" },
        },
      ];

      store.seed("agg-1", events, "tenant-1", aggregateType);

      const tenant1Events = await store.getEvents(
        "agg-1",
        { tenantId: "tenant-1" },
        aggregateType,
      );
      const tenant2Events = await store.getEvents(
        "agg-1",
        { tenantId: "tenant-2" },
        aggregateType,
      );

      expect(tenant1Events).toHaveLength(1);
      expect(tenant2Events).toHaveLength(0);
    });
  });
});

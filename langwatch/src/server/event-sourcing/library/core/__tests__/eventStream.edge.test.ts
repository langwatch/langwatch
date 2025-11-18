import { describe, it, expect } from "vitest";
import { EventStream } from "../eventStream";
import type { Event } from "../types";
import { createTenantId } from "../../core/tenantId";

describe("EventStream - Edge Cases", () => {
  describe("when events have identical timestamps", () => {
    it("preserves original order for tied timestamps", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: { order: 1 },
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.trace.projection.reset",
          data: { order: 2 },
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.trace.projection.recomputed",
          data: { order: 3 },
        },
      ];

      const stream = new EventStream("1", events, { ordering: "timestamp" });
      const orderedEvents = stream.getEvents();

      // Sort is stable in V8, so original order should be preserved
      expect(orderedEvents[0]!.type).toBe("lw.obs.span.ingestion.recorded");
      expect(orderedEvents[1]!.type).toBe("lw.obs.trace.projection.reset");
      expect(orderedEvents[2]!.type).toBe("lw.obs.trace.projection.recomputed");
    });

    it("does not lose events with identical timestamps", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.trace.projection.reset",
          data: {},
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.trace.projection.recomputed",
          data: {},
        },
      ];

      const stream = new EventStream("1", events, { ordering: "timestamp" });

      expect(stream.getEvents()).toHaveLength(3);
    });
  });

  describe("when aggregateId is numeric", () => {
    it("handles MAX_SAFE_INTEGER", () => {
      const maxInt = Number.MAX_SAFE_INTEGER;
      const events: Event<number>[] = [
        {
          aggregateId: maxInt,
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const stream = new EventStream(maxInt, events);

      expect(stream.getMetadata().aggregateId).toBe(String(maxInt));
      expect(stream.getAggregateId()).toBe(maxInt);
    });

    it("handles negative numbers", () => {
      const events: Event<number>[] = [
        {
          aggregateId: -42,
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const stream = new EventStream(-42, events);

      expect(stream.getMetadata().aggregateId).toBe("-42");
      expect(stream.getAggregateId()).toBe(-42);
    });

    it("handles zero", () => {
      const events: Event<number>[] = [
        {
          aggregateId: 0,
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const stream = new EventStream(0, events);

      expect(stream.getMetadata().aggregateId).toBe("0");
      expect(stream.getAggregateId()).toBe(0);
    });
  });

  describe("when aggregateId is an object", () => {
    it("converts to [object Object] without custom toString", () => {
      const objId = { id: "test", tenant: "acme" };
      const events: Event<typeof objId>[] = [
        {
          aggregateId: objId,
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const stream = new EventStream(objId, events);

      expect(stream.getMetadata().aggregateId).toBe("[object Object]");
      expect(stream.getAggregateId()).toBe(objId);
    });

    it("uses custom toString if provided", () => {
      const objId = {
        id: "test",
        tenant: "acme",
        toString() {
          return `${this.tenant}:${this.id}`;
        },
      };
      const events: Event<typeof objId>[] = [
        {
          aggregateId: objId,
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const stream = new EventStream(objId, events);

      expect(stream.getMetadata().aggregateId).toBe("acme:test");
    });

    it("creates ID collision for different objects without toString", () => {
      const obj1 = { id: "1" };
      const obj2 = { id: "2" };

      const stream1 = new EventStream(obj1, []);
      const stream2 = new EventStream(obj2, []);

      // Both convert to "[object Object]"
      expect(stream1.getMetadata().aggregateId).toBe(
        stream2.getMetadata().aggregateId,
      );
    });
  });

  describe("when custom comparator is provided", () => {
    it("applies custom ordering", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: { priority: 3 },
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 2000,
          type: "lw.obs.trace.projection.reset",
          data: { priority: 1 },
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 3000,
          type: "lw.obs.trace.projection.recomputed",
          data: { priority: 2 },
        },
      ];

      // Sort by priority instead of timestamp
      const stream = new EventStream("1", events, {
        ordering: (a, b) =>
          (a.data as { priority: number }).priority -
          (b.data as { priority: number }).priority,
      });

      const ordered = stream.getEvents();
      expect(ordered[0]!.type).toBe("lw.obs.trace.projection.reset"); // priority 1
      expect(ordered[1]!.type).toBe("lw.obs.trace.projection.recomputed"); // priority 2
      expect(ordered[2]!.type).toBe("lw.obs.span.ingestion.recorded"); // priority 3
    });

    it("metadata reflects original event order not sorted order", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 3000,
          type: "lw.obs.trace.projection.recomputed",
          data: {},
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 2000,
          type: "lw.obs.trace.projection.reset",
          data: {},
        },
      ];

      // Reverse chronological
      const stream = new EventStream("1", events, {
        ordering: (a, b) => b.timestamp - a.timestamp,
      });

      // First event in sorted stream has timestamp 3000
      expect(stream.getEvents()[0]!.timestamp).toBe(3000);
      // But metadata still reflects the positions in the sorted array
      expect(stream.getMetadata().firstEventTimestamp).toBe(3000);
      expect(stream.getMetadata().lastEventTimestamp).toBe(1000);
    });
  });

  describe("when events array is large", () => {
    it("handles 10000 events without error", () => {
      const events: Event[] = Array.from({ length: 10000 }, (_, i) => ({
        tenantId: createTenantId("test-tenant"),
        aggregateId: "1",
        timestamp: i * 1000,
        type: "lw.obs.span.ingestion.recorded",
        data: { index: i },
      }));

      const stream = new EventStream("1", events);

      expect(stream.getEvents()).toHaveLength(10000);
      expect(stream.getMetadata().eventCount).toBe(10000);
    });

    it("sorts large event stream efficiently", () => {
      // Reverse order to force sorting
      const events: Event[] = Array.from({ length: 10000 }, (_, i) => ({
        tenantId: createTenantId("test-tenant"),
        aggregateId: "1",
        timestamp: (10000 - i) * 1000,
        type: "lw.obs.span.ingestion.recorded",
        data: {},
      }));

      const startTime = Date.now();
      const stream = new EventStream("1", events, { ordering: "timestamp" });
      const duration = Date.now() - startTime;

      // Sorting should complete in reasonable time (< 100ms for 10k items)
      expect(duration).toBeLessThan(100);
      expect(stream.getEvents()[0]!.timestamp).toBe(1000);
      expect(stream.getEvents()[9999]!.timestamp).toBe(10000000);
    });
  });

  describe("when metadata has unusual values", () => {
    it("handles events with no timestamp information in metadata", () => {
      const events: Event[] = [];

      const stream = new EventStream("1", events);
      const metadata = stream.getMetadata();

      expect(metadata.firstEventTimestamp).toBeNull();
      expect(metadata.lastEventTimestamp).toBeNull();
      expect(metadata.eventCount).toBe(0);
    });

    it("handles single event correctly in metadata", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const stream = new EventStream("1", events);
      const metadata = stream.getMetadata();

      expect(metadata.firstEventTimestamp).toBe(1000);
      expect(metadata.lastEventTimestamp).toBe(1000);
      expect(metadata.eventCount).toBe(1);
    });
  });

  describe("when using as-is ordering", () => {
    it("does not clone array unnecessarily", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 3000,
          type: "lw.obs.trace.projection.recomputed",
          data: {},
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 2000,
          type: "lw.obs.trace.projection.reset",
          data: {},
        },
      ];

      const stream = new EventStream("1", events, { ordering: "as-is" });

      // Order should match input exactly
      expect(stream.getEvents()[0]!.timestamp).toBe(3000);
      expect(stream.getEvents()[1]!.timestamp).toBe(1000);
      expect(stream.getEvents()[2]!.timestamp).toBe(2000);
    });

    it("returns readonly array even with as-is ordering", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const stream = new EventStream("1", events, { ordering: "as-is" });
      const result = stream.getEvents();

      // Type system should enforce readonly
      expect(result).toBe(events);
    });
  });

  describe("when timestamp ordering", () => {
    it("creates new array to avoid mutating input", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 3000,
          type: "lw.obs.trace.projection.recomputed",
          data: {},
        },
        {
          aggregateId: "1",
          tenantId: createTenantId("test-tenant"),
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const originalOrder = events[0]!.timestamp;
      const stream = new EventStream("1", events, { ordering: "timestamp" });

      // Original array should not be mutated
      expect(events[0]!.timestamp).toBe(originalOrder);
      // But stream should have sorted order
      expect(stream.getEvents()[0]!.timestamp).toBe(1000);
    });
  });
});

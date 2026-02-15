import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import { EVENT_TYPES } from "../../domain/eventType";
import { createTenantId, type TenantId } from "../../domain/tenantId";
import type { Event, EventOrderingStrategy } from "../../domain/types";
import { EventStream } from "../eventStream";

type TestEvent = Event<{ value: string }>;

function createTestEvent(
  id: string,
  aggregateId: string,
  tenantId: TenantId,
  timestamp: number,
  type: (typeof EVENT_TYPES)[number] = EVENT_TYPES[0],
  version = "2025-12-17",
): TestEvent {
  return {
    id,
    aggregateId,
    aggregateType: "test-aggregate" as AggregateType,
    tenantId,
    timestamp,
    occurredAt: timestamp,
    version,
    type,
    data: { value: `event-${id}` },
  };
}

function createTestTenantId(value: string): TenantId {
  return createTenantId(value);
}

describe("EventStream", () => {
  let tenantId: TenantId;
  const baseTimestamp = 1000000;

  beforeEach(() => {
    tenantId = createTestTenantId("test-tenant");
    vi.useFakeTimers();
    vi.setSystemTime(baseTimestamp);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    describe("when ordering is 'as-is'", () => {
      it("preserves event order without sorting or cloning", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
        ];

        const stream = new EventStream("agg1", tenantId, events, {
          ordering: "as-is",
        });

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents).toHaveLength(3);
        expect(retrievedEvents[0]!.id).toBe("e3");
        expect(retrievedEvents[1]!.id).toBe("e1");
        expect(retrievedEvents[2]!.id).toBe("e2");
      });

      it("uses the same array reference when ordering is 'as-is'", () => {
        // This optimization avoids unnecessary cloning when upstream already provides ordered events
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];

        const stream = new EventStream("agg1", tenantId, events, {
          ordering: "as-is",
        });

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents).toBe(events);
      });

      it("handles empty array with 'as-is' ordering", () => {
        const events: readonly TestEvent[] = [];
        const stream = new EventStream("agg1", tenantId, events, {
          ordering: "as-is",
        });

        expect(stream.getEvents()).toHaveLength(0);
        expect(stream.isEmpty()).toBe(true);
      });
    });

    describe("when ordering is 'timestamp'", () => {
      it("sorts events chronologically by timestamp", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
        ];

        const stream = new EventStream("agg1", tenantId, events, {
          ordering: "timestamp",
        });

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents).toHaveLength(3);
        expect(retrievedEvents[0]!.id).toBe("e1");
        expect(retrievedEvents[0]!.timestamp).toBe(baseTimestamp + 100);
        expect(retrievedEvents[1]!.id).toBe("e2");
        expect(retrievedEvents[1]!.timestamp).toBe(baseTimestamp + 200);
        expect(retrievedEvents[2]!.id).toBe("e3");
        expect(retrievedEvents[2]!.timestamp).toBe(baseTimestamp + 300);
      });

      it("creates a new array when ordering is 'timestamp'", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];

        const stream = new EventStream("agg1", tenantId, events, {
          ordering: "timestamp",
        });

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents).not.toBe(events);
        expect(retrievedEvents).toHaveLength(1);
        expect(retrievedEvents[0]).toEqual(events[0]);
      });

      it("handles events with duplicate timestamps", () => {
        const sameTimestamp = baseTimestamp + 100;
        const events: readonly TestEvent[] = [
          createTestEvent("e2", "agg1", tenantId, sameTimestamp),
          createTestEvent("e1", "agg1", tenantId, sameTimestamp),
          createTestEvent("e3", "agg1", tenantId, sameTimestamp),
        ];

        const stream = new EventStream("agg1", tenantId, events, {
          ordering: "timestamp",
        });

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents).toHaveLength(3);
        expect(retrievedEvents[0]!.timestamp).toBe(sameTimestamp);
        expect(retrievedEvents[1]!.timestamp).toBe(sameTimestamp);
        expect(retrievedEvents[2]!.timestamp).toBe(sameTimestamp);
      });
    });

    describe("when ordering is a custom function", () => {
      it("uses custom comparator function for sorting", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
        ];

        const customOrdering: EventOrderingStrategy<TestEvent> = (a, b) =>
          b.timestamp - a.timestamp;

        const stream = new EventStream("agg1", tenantId, events, {
          ordering: customOrdering,
        });

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents[0]!.id).toBe("e3");
        expect(retrievedEvents[1]!.id).toBe("e2");
        expect(retrievedEvents[2]!.id).toBe("e1");
      });

      it("creates a new array when using custom ordering", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];

        const customOrdering: EventOrderingStrategy<TestEvent> = (a, b) =>
          a.timestamp - b.timestamp;

        const stream = new EventStream("agg1", tenantId, events, {
          ordering: customOrdering,
        });

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents).not.toBe(events);
        expect(retrievedEvents).toHaveLength(1);
      });
    });

    describe("when ordering is not specified", () => {
      it("defaults to 'timestamp' ordering", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
        ];

        const stream = new EventStream("agg1", tenantId, events);

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents[0]!.id).toBe("e1");
        expect(retrievedEvents[1]!.id).toBe("e2");
        expect(retrievedEvents[2]!.id).toBe("e3");
      });
    });

    describe("when events array is empty", () => {
      it("creates stream with empty events", () => {
        const events: readonly TestEvent[] = [];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getEvents()).toHaveLength(0);
        expect(stream.isEmpty()).toBe(true);
      });
    });

    describe("when events array has single event", () => {
      it("creates stream with single event", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getEvents()).toHaveLength(1);
        expect(stream.getEvents()[0]).toEqual(events[0]);
        expect(stream.isEmpty()).toBe(false);
      });
    });
  });

  describe("aggregate ID handling", () => {
    describe("when aggregate ID is a string", () => {
      it("preserves string aggregate ID", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getAggregateId()).toBe("agg1");
        expect(stream.getMetadata().aggregateId).toBe("agg1");
      });
    });

    describe("when aggregate ID is a number", () => {
      it("converts numeric aggregate ID to string in metadata", () => {
        const numericId = 12345;
        const events: readonly TestEvent[] = [
          createTestEvent(
            "e1",
            String(numericId),
            tenantId,
            baseTimestamp + 100,
          ),
        ];
        const stream = new EventStream(
          numericId as unknown as string,
          tenantId,
          events,
        );

        expect(stream.getAggregateId()).toBe(numericId);
        expect(stream.getMetadata().aggregateId).toBe("12345");
      });
    });

    describe("when aggregate ID is an object", () => {
      it("converts object aggregate ID to string using String()", () => {
        const objectId = { id: "test" };
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "test", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream(
          objectId as unknown as string,
          tenantId,
          events,
        );

        expect(stream.getMetadata().aggregateId).toBe("[object Object]");
      });

      it("demonstrates security risk: different objects map to same string", () => {
        // This test documents a security concern: when objects are used as aggregate IDs,
        // they all convert to "[object Object]", causing ID collisions that could lead
        // to cross-aggregate data leakage. This is why the class documentation warns
        // against using objects as aggregate IDs.
        const objectId1 = { id: "test1" };
        const objectId2 = { id: "test2" };
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "test", tenantId, baseTimestamp + 100),
        ];

        const stream1 = new EventStream(
          objectId1 as unknown as string,
          tenantId,
          events,
        );
        const stream2 = new EventStream(
          objectId2 as unknown as string,
          tenantId,
          events,
        );

        expect(stream1.getMetadata().aggregateId).toBe("[object Object]");
        expect(stream2.getMetadata().aggregateId).toBe("[object Object]");
        expect(stream1.getMetadata().aggregateId).toBe(
          stream2.getMetadata().aggregateId,
        );
      });

      it("demonstrates potential data leakage risk with object aggregate IDs", () => {
        // This test shows how different aggregates from different tenants could
        // be confused if objects are used as aggregate IDs, since they all map
        // to the same string representation.
        const objectId1 = { tenant: "tenant1", id: "agg1" };
        const objectId2 = { tenant: "tenant2", id: "agg2" };
        const events1: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const events2: readonly TestEvent[] = [
          createTestEvent("e2", "agg2", tenantId, baseTimestamp + 200),
        ];

        const stream1 = new EventStream(
          objectId1 as unknown as string,
          tenantId,
          events1,
        );
        const stream2 = new EventStream(
          objectId2 as unknown as string,
          tenantId,
          events2,
        );

        expect(stream1.getMetadata().aggregateId).toBe(
          stream2.getMetadata().aggregateId,
        );
      });
    });
  });

  describe("metadata calculation", () => {
    describe("event count", () => {
      it("returns zero for empty stream", () => {
        const events: readonly TestEvent[] = [];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getMetadata().eventCount).toBe(0);
      });

      it("returns correct count for events", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getMetadata().eventCount).toBe(3);
      });
    });

    describe("first event timestamp", () => {
      it("returns null for empty stream", () => {
        const events: readonly TestEvent[] = [];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getMetadata().firstEventTimestamp).toBeNull();
      });

      it("returns timestamp of first event after ordering", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getMetadata().firstEventTimestamp).toBe(
          baseTimestamp + 100,
        );
      });

      it("returns correct timestamp when using 'as-is' ordering", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", tenantId, events, {
          ordering: "as-is",
        });

        expect(stream.getMetadata().firstEventTimestamp).toBe(
          baseTimestamp + 300,
        );
      });
    });

    describe("last event timestamp", () => {
      it("returns null for empty stream", () => {
        const events: readonly TestEvent[] = [];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getMetadata().lastEventTimestamp).toBeNull();
      });

      it("returns timestamp of last event after ordering", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getMetadata().lastEventTimestamp).toBe(
          baseTimestamp + 300,
        );
      });

      it("returns correct timestamp when using 'as-is' ordering", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e3", "agg1", tenantId, baseTimestamp + 300),
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", tenantId, events, {
          ordering: "as-is",
        });

        expect(stream.getMetadata().lastEventTimestamp).toBe(
          baseTimestamp + 100,
        );
      });
    });

    describe("aggregate ID in metadata", () => {
      it("stores aggregate ID correctly in metadata", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getMetadata().aggregateId).toBe("agg1");
      });

      it("converts numeric aggregate ID to string in metadata", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "123", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream(
          123 as unknown as string,
          tenantId,
          events,
        );

        expect(stream.getMetadata().aggregateId).toBe("123");
      });
    });
  });

  describe("getter methods", () => {
    describe("getAggregateId", () => {
      it("returns the aggregate ID", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.getAggregateId()).toBe("agg1");
      });
    });

    describe("getEvents", () => {
      it("returns readonly array of ordered events", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        const retrievedEvents = stream.getEvents();
        expect(retrievedEvents).toHaveLength(2);
        expect(retrievedEvents[0]!.id).toBe("e1");
        expect(retrievedEvents[1]!.id).toBe("e2");
      });
    });

    describe("getMetadata", () => {
      it("returns correct metadata object", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", tenantId, baseTimestamp + 200),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        const metadata = stream.getMetadata();
        expect(metadata.aggregateId).toBe("agg1");
        expect(metadata.eventCount).toBe(2);
        expect(metadata.firstEventTimestamp).toBe(baseTimestamp + 100);
        expect(metadata.lastEventTimestamp).toBe(baseTimestamp + 200);
      });
    });

    describe("getTenantId", () => {
      it("returns the tenant ID", () => {
        const testTenantId = createTestTenantId("tenant-123");
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", testTenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", testTenantId, events);

        expect(stream.getTenantId()).toBe(testTenantId);
      });
    });

    describe("isEmpty", () => {
      it("returns true for empty stream", () => {
        const events: readonly TestEvent[] = [];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.isEmpty()).toBe(true);
      });

      it("returns false for stream with events", () => {
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", tenantId, events);

        expect(stream.isEmpty()).toBe(false);
      });
    });
  });

  describe("security and validation", () => {
    describe("aggregate ID collision risk", () => {
      it("demonstrates that different objects produce same string representation", () => {
        const objectId1 = { id: "test1", name: "object1" };
        const objectId2 = { id: "test2", name: "object2" };
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "test", tenantId, baseTimestamp + 100),
        ];

        const stream1 = new EventStream(
          objectId1 as unknown as string,
          tenantId,
          events,
        );
        const stream2 = new EventStream(
          objectId2 as unknown as string,
          tenantId,
          events,
        );

        const metadata1 = stream1.getMetadata();
        const metadata2 = stream2.getMetadata();

        expect(metadata1.aggregateId).toBe("[object Object]");
        expect(metadata2.aggregateId).toBe("[object Object]");
        expect(metadata1.aggregateId).toBe(metadata2.aggregateId);
      });

      it("demonstrates potential data leakage risk with object aggregate IDs", () => {
        const objectId1 = { tenant: "tenant1", id: "agg1" };
        const objectId2 = { tenant: "tenant2", id: "agg2" };
        const events1: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId, baseTimestamp + 100),
        ];
        const events2: readonly TestEvent[] = [
          createTestEvent("e2", "agg2", tenantId, baseTimestamp + 200),
        ];

        const stream1 = new EventStream(
          objectId1 as unknown as string,
          tenantId,
          events1,
        );
        const stream2 = new EventStream(
          objectId2 as unknown as string,
          tenantId,
          events2,
        );

        expect(stream1.getMetadata().aggregateId).toBe(
          stream2.getMetadata().aggregateId,
        );
      });
    });

    describe("tenant ID isolation", () => {
      it("correctly stores and retrieves tenant ID", () => {
        const testTenantId = createTestTenantId("isolated-tenant");
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", testTenantId, baseTimestamp + 100),
        ];
        const stream = new EventStream("agg1", testTenantId, events);

        expect(stream.getTenantId()).toBe(testTenantId);
      });

      it("maintains tenant ID across multiple streams with same tenant", () => {
        const testTenantId = createTestTenantId("same-tenant");
        const events1: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", testTenantId, baseTimestamp + 100),
        ];
        const events2: readonly TestEvent[] = [
          createTestEvent("e2", "agg2", testTenantId, baseTimestamp + 200),
        ];

        const stream1 = new EventStream("agg1", testTenantId, events1);
        const stream2 = new EventStream("agg2", testTenantId, events2);

        expect(stream1.getTenantId()).toBe(testTenantId);
        expect(stream2.getTenantId()).toBe(testTenantId);
        expect(stream1.getTenantId()).toBe(stream2.getTenantId());
      });

      it("maintains tenant ID isolation between different tenants", () => {
        const tenantId1 = createTestTenantId("tenant-1");
        const tenantId2 = createTestTenantId("tenant-2");
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", tenantId1, baseTimestamp + 100),
        ];

        const stream1 = new EventStream("agg1", tenantId1, events);
        const stream2 = new EventStream("agg1", tenantId2, events);

        expect(stream1.getTenantId()).toBe(tenantId1);
        expect(stream2.getTenantId()).toBe(tenantId2);
        expect(stream1.getTenantId()).not.toBe(stream2.getTenantId());
      });

      it("preserves tenant ID through stream operations", () => {
        const testTenantId = createTestTenantId("preserved-tenant");
        const events: readonly TestEvent[] = [
          createTestEvent("e1", "agg1", testTenantId, baseTimestamp + 100),
          createTestEvent("e2", "agg1", testTenantId, baseTimestamp + 200),
        ];
        const stream = new EventStream("agg1", testTenantId, events);

        expect(stream.getTenantId()).toBe(testTenantId);
        expect(stream.getEvents()).toHaveLength(2);
        expect(stream.getMetadata().eventCount).toBe(2);
        expect(stream.getTenantId()).toBe(testTenantId);
      });
    });
  });
});

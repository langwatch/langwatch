import { describe, it, expect, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import { EventUtils } from "../event.utils";
import type { Event, Projection } from "../../core/types";

describe("createEvent", () => {
  describe("when called with basic data", () => {
    it("returns an event with the provided fields", () => {
      const event = EventUtils.createEvent("agg-1", "span.ingestion.ingested", { foo: "bar" });

      expect(event.aggregateId).toBe("agg-1");
    });
  });
});

describe("createEventWithProcessingTraceContext", () => {
  describe("when metadata already has processingTraceparent", () => {
    it("preserves existing processingTraceparent", () => {
      const event = EventUtils.createEventWithProcessingTraceContext(
        "agg-1",
        "span.ingestion.ingested",
        {
          foo: "bar",
        },
        {
          processingTraceparent: "00-test-trace-span-01",
          custom: "value",
        },
      );

      expect(event.metadata?.processingTraceparent).toBe(
        "00-test-trace-span-01",
      );
      expect(event.metadata?.custom).toBe("value");
    });
  });

  describe("when there is no active span and no metadata", () => {
    it("does not set metadata", () => {
      const getSpanSpy = vi
        .spyOn(trace, "getSpan")
        .mockReturnValue(void 0 as any);

      const event = EventUtils.createEventWithProcessingTraceContext(
        "agg-1",
        "span.ingestion.ingested",
        {
          foo: "bar",
        },
      );

      expect(event.metadata).toBeUndefined();

      getSpanSpy.mockRestore();
    });
  });

  describe("when active span exists but spanContext has missing traceId", () => {
    it("does not set processingTraceparent", () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: "",
          spanId: "valid-span-id-123",
          traceFlags: 1,
        }),
      };

      const getSpanSpy = vi
        .spyOn(trace, "getSpan")
        .mockReturnValue(mockSpan as any);

      const event = EventUtils.createEventWithProcessingTraceContext(
        "agg-1",
        "span.ingestion.ingested",
        {
          foo: "bar",
        },
      );

      expect(event.metadata).toBeUndefined();

      getSpanSpy.mockRestore();
    });
  });

  describe("when active span exists but spanContext has missing spanId", () => {
    it("does not set processingTraceparent", () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: "valid-trace-id-abc",
          spanId: "",
          traceFlags: 1,
        }),
      };

      const getSpanSpy = vi
        .spyOn(trace, "getSpan")
        .mockReturnValue(mockSpan as any);

      const event = EventUtils.createEventWithProcessingTraceContext(
        "agg-1",
        "span.ingestion.ingested",
        {
          foo: "bar",
        },
      );

      expect(event.metadata).toBeUndefined();

      getSpanSpy.mockRestore();
    });
  });

  describe("when active span exists but spanContext has null traceId", () => {
    it("does not set processingTraceparent", () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: null as any,
          spanId: "valid-span-id-123",
          traceFlags: 1,
        }),
      };

      const getSpanSpy = vi
        .spyOn(trace, "getSpan")
        .mockReturnValue(mockSpan as any);

      const event = EventUtils.createEventWithProcessingTraceContext(
        "agg-1",
        "span.ingestion.ingested",
        {
          foo: "bar",
        },
      );

      expect(event.metadata).toBeUndefined();

      getSpanSpy.mockRestore();
    });
  });

  describe("when active span exists but spanContext has null spanId", () => {
    it("does not set processingTraceparent", () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: "valid-trace-id-abc",
          spanId: null as any,
          traceFlags: 1,
        }),
      };

      const getSpanSpy = vi
        .spyOn(trace, "getSpan")
        .mockReturnValue(mockSpan as any);

      const event = EventUtils.createEventWithProcessingTraceContext(
        "agg-1",
        "span.ingestion.ingested",
        {
          foo: "bar",
        },
      );

      expect(event.metadata).toBeUndefined();

      getSpanSpy.mockRestore();
    });
  });

  describe("when active span exists but spanContext has undefined traceId", () => {
    it("does not set processingTraceparent", () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: void 0 as any,
          spanId: "valid-span-id-123",
          traceFlags: 1,
        }),
      };

      const getSpanSpy = vi
        .spyOn(trace, "getSpan")
        .mockReturnValue(mockSpan as any);

      const event = EventUtils.createEventWithProcessingTraceContext(
        "agg-1",
        "span.ingestion.ingested",
        {
          foo: "bar",
        },
      );

      expect(event.metadata).toBeUndefined();

      getSpanSpy.mockRestore();
    });
  });

  describe("when active span exists but spanContext has undefined spanId", () => {
    it("does not set processingTraceparent", () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: "valid-trace-id-abc",
          spanId: void 0 as any,
          traceFlags: 1,
        }),
      };

      const getSpanSpy = vi
        .spyOn(trace, "getSpan")
        .mockReturnValue(mockSpan as any);

      const event = EventUtils.createEventWithProcessingTraceContext(
        "agg-1",
        "span.ingestion.ingested",
        {
          foo: "bar",
        },
      );

      expect(event.metadata).toBeUndefined();

      getSpanSpy.mockRestore();
    });
  });
});

describe("createProjection", () => {
  describe("when called with basic data", () => {
    it("returns a projection with the provided fields", () => {
      const projection = EventUtils.createProjection("proj-1", "agg-1", {
        foo: "bar",
      });

      expect(projection.id).toBe("proj-1");
    });
  });
});

describe("eventBelongsToAggregate", () => {
  describe("when event belongs to aggregate", () => {
    it("returns true", () => {
      const event: Event = {
        aggregateId: "test-123",
        timestamp: Date.now(),
        type: "span.ingestion.ingested",
        data: {},
      };

      expect(EventUtils.eventBelongsToAggregate(event, "test-123")).toBe(true);
    });
  });

  describe("when event does not belong to aggregate", () => {
    it("returns false", () => {
      const event: Event = {
        aggregateId: "test-123",
        timestamp: Date.now(),
        type: "span.ingestion.ingested",
        data: {},
      };

      expect(EventUtils.eventBelongsToAggregate(event, "different-123")).toBe(
        false,
      );
    });
  });
});

describe("sortEventsByTimestamp", () => {
  describe("when events are unsorted", () => {
    it("returns chronologically sorted events", () => {
      const events: Event[] = [
        { aggregateId: "1", timestamp: 3000, type: "C" as any, data: {} },
        { aggregateId: "1", timestamp: 1000, type: "A" as any, data: {} },
        { aggregateId: "1", timestamp: 2000, type: "B" as any, data: {} },
      ];

      const sorted = EventUtils.sortEventsByTimestamp(events);

      expect(sorted[0]!.timestamp).toBe(1000);
    });
  });

  describe("when events are already sorted", () => {
    it("maintains order", () => {
      const events: Event[] = [
        {
          aggregateId: "1",
          timestamp: 1000,
          type: "span.ingestion.ingested",
          data: {},
        },
        {
          aggregateId: "1",
          timestamp: 2000,
          type: "trace.projection.reset",
          data: {},
        },
        {
          aggregateId: "1",
          timestamp: 3000,
          type: "trace.projection.recomputed",
          data: {},
        },
      ];

      const sorted = EventUtils.sortEventsByTimestamp(events);

      expect(sorted[0]!.timestamp).toBe(1000);
    });
  });
});

describe("filterEventsByType", () => {
  describe("when events match type", () => {
    it("returns matching events", () => {
      const events: Event[] = [
        { aggregateId: "1", timestamp: 1000, type: "CREATE" as any, data: {} },
        { aggregateId: "1", timestamp: 2000, type: "UPDATE" as any, data: {} },
        { aggregateId: "1", timestamp: 3000, type: "CREATE", data: {} },
      ];

      const filtered = EventUtils.filterEventsByType(events, "CREATE");

      expect(filtered).toHaveLength(2);
    });
  });

  describe("when no events match type", () => {
    it("returns empty array", () => {
      const events: Event[] = [
        { aggregateId: "1", timestamp: 1000, type: "CREATE" as any, data: {} },
        { aggregateId: "1", timestamp: 2000, type: "UPDATE" as any, data: {} },
      ];

      const filtered = EventUtils.filterEventsByType(events, "DELETE");

      expect(filtered).toHaveLength(0);
    });
  });
});

describe("getLatestProjection", () => {
  describe("when projections array is empty", () => {
    it("returns null", () => {
      const projections: Projection[] = [];

      const latest = EventUtils.getLatestProjection(projections);

      expect(latest).toBeNull();
    });
  });

  describe("when projections have different versions", () => {
    it("returns highest version", () => {
      const projections: Projection[] = [
        { id: "1", aggregateId: "a", version: 100, data: {} },
        { id: "2", aggregateId: "a", version: 300, data: {} },
        { id: "3", aggregateId: "a", version: 200, data: {} },
      ];

      const latest = EventUtils.getLatestProjection(projections);

      expect(latest?.version).toBe(300);
    });
  });

  describe("when projections have same version", () => {
    it("returns one of them", () => {
      const projections: Projection[] = [
        { id: "1", aggregateId: "a", version: 100, data: {} },
        { id: "2", aggregateId: "a", version: 100, data: {} },
      ];

      const latest = EventUtils.getLatestProjection(projections);

      expect(latest?.version).toBe(100);
    });
  });
});

describe("isValidEvent", () => {
  describe("when event is valid", () => {
    it("returns true", () => {
      const event = {
        aggregateId: "test-123",
        timestamp: 1234567890,
        type: "span.ingestion.ingested",
        data: { value: 42 },
      };

      expect(EventUtils.isValidEvent(event)).toBe(true);
    });
  });

  describe("when aggregateId is missing", () => {
    it("returns false", () => {
      const event = {
        timestamp: 1234567890,
        type: "span.ingestion.ingested",
        data: { value: 42 },
      };

      expect(EventUtils.isValidEvent(event)).toBe(false);
    });
  });

  describe("when timestamp is not a number", () => {
    it("returns false", () => {
      const event = {
        aggregateId: "test-123",
        timestamp: "not-a-number",
        type: "span.ingestion.ingested",
        data: { value: 42 },
      };

      expect(EventUtils.isValidEvent(event)).toBe(false);
    });
  });

  describe("when type is not a string", () => {
    it("returns false", () => {
      const event = {
        aggregateId: "test-123",
        timestamp: 1234567890,
        type: 123,
        data: { value: 42 },
      };

      expect(EventUtils.isValidEvent(event)).toBe(false);
    });
  });

  describe("when data is undefined", () => {
    it("returns false", () => {
      const event = {
        aggregateId: "test-123",
        timestamp: 1234567890,
        type: "span.ingestion.ingested",
      };

      expect(EventUtils.isValidEvent(event)).toBe(false);
    });
  });

  describe("when event is null", () => {
    it("returns false", () => {
      expect(EventUtils.isValidEvent(null)).toBeFalsy();
    });
  });

  describe("when event is undefined", () => {
    it("returns false", () => {
      expect(EventUtils.isValidEvent(void 0)).toBeFalsy();
    });
  });
});

describe("isValidProjection", () => {
  describe("when projection is valid", () => {
    it("returns true", () => {
      const projection = {
        id: "proj-123",
        aggregateId: "test-123",
        version: 1234567890,
        data: { value: 42 },
      };

      expect(EventUtils.isValidProjection(projection)).toBe(true);
    });
  });

  describe("when id is not a string", () => {
    it("returns false", () => {
      const projection = {
        id: 123,
        aggregateId: "test-123",
        version: 1234567890,
        data: { value: 42 },
      };

      expect(EventUtils.isValidProjection(projection)).toBe(false);
    });
  });

  describe("when aggregateId is missing", () => {
    it("returns false", () => {
      const projection = {
        id: "proj-123",
        version: 1234567890,
        data: { value: 42 },
      };

      expect(EventUtils.isValidProjection(projection)).toBe(false);
    });
  });

  describe("when version is not a number", () => {
    it("returns false", () => {
      const projection = {
        id: "proj-123",
        aggregateId: "test-123",
        version: "not-a-number",
        data: { value: 42 },
      };

      expect(EventUtils.isValidProjection(projection)).toBe(false);
    });
  });

  describe("when data is undefined", () => {
    it("returns false", () => {
      const projection = {
        id: "proj-123",
        aggregateId: "test-123",
        version: 1234567890,
      };

      expect(EventUtils.isValidProjection(projection)).toBe(false);
    });
  });

  describe("when projection is null", () => {
    it("returns false", () => {
      expect(EventUtils.isValidProjection(null)).toBe(false);
    });
  });

  describe("when projection is undefined", () => {
    it("returns false", () => {
      expect(EventUtils.isValidProjection(void 0)).toBe(false);
    });
  });
});

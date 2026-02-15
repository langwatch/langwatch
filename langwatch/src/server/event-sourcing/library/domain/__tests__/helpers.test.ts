import { describe, expect, it } from "vitest";
import type { AggregateType } from "../aggregateType";
import { EVENT_TYPES } from "../eventType";
import { isEvent, isProjection } from "../helpers";
import { createTenantId, type TenantId } from "../tenantId";
import type { Event, Projection } from "../types";

function createValidEvent(
  id = "event-1",
  aggregateId = "agg-1",
  aggregateType: AggregateType = "trace",
  tenantId: TenantId = createTenantId("tenant-1"),
  timestamp = 1000000,
  type: (typeof EVENT_TYPES)[number] = EVENT_TYPES[0]!,
  data: unknown = { value: "test" },
  version = "2025-12-17",
): Event {
  return {
    id,
    aggregateId,
    aggregateType,
    tenantId,
    timestamp,
    occurredAt: timestamp,
    type,
    data,
    version,
  };
}

function createValidProjection(
  id = "proj-1",
  aggregateId = "agg-1",
  tenantId: TenantId = createTenantId("tenant-1"),
  version = "2025-12-17",
  data: unknown = { value: "test" },
): Projection {
  return {
    id,
    aggregateId,
    tenantId,
    version,
    data,
  };
}

describe("isEvent", () => {
  describe("when value is a valid Event", () => {
    it("returns true for complete valid Event", () => {
      const event = createValidEvent();
      expect(isEvent(event)).toBe(true);
    });

    it("returns true for Event with optional metadata", () => {
      const event: Event = {
        ...createValidEvent(),
        metadata: { processingTraceparent: "00-trace-01" },
      };
      expect(isEvent(event)).toBe(true);
    });

    it("returns true for Event with string payload", () => {
      const event = createValidEvent(
        "event-1",
        "agg-1",
        "trace",
        createTenantId("tenant-1"),
        1000000,
        EVENT_TYPES[0]!,
        "string data",
      );
      expect(isEvent(event)).toBe(true);
    });

    it("returns true for Event with number payload", () => {
      const event = createValidEvent(
        "event-1",
        "agg-1",
        "trace",
        createTenantId("tenant-1"),
        1000000,
        EVENT_TYPES[0]!,
        42,
      );
      expect(isEvent(event)).toBe(true);
    });

    it("returns true for Event with object payload", () => {
      const event = createValidEvent(
        "event-1",
        "agg-1",
        "trace",
        createTenantId("tenant-1"),
        1000000,
        EVENT_TYPES[0]!,
        { nested: { data: "value" } },
      );
      expect(isEvent(event)).toBe(true);
    });

    it("returns true for Event with array payload", () => {
      const event = createValidEvent(
        "event-1",
        "agg-1",
        "trace",
        createTenantId("tenant-1"),
        1000000,
        EVENT_TYPES[0]!,
        [1, 2, 3],
      );
      expect(isEvent(event)).toBe(true);
    });

    it("returns true for Event with null payload", () => {
      const event = createValidEvent(
        "event-1",
        "agg-1",
        "trace",
        createTenantId("tenant-1"),
        1000000,
        EVENT_TYPES[0]!,
        null,
      );
      expect(isEvent(event)).toBe(true);
    });
  });

  describe("when value is not an object", () => {
    it("returns false for null", () => {
      expect(isEvent(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isEvent(undefined)).toBe(false);
    });

    it("returns false for string", () => {
      expect(isEvent("not an event")).toBe(false);
    });

    it("returns false for number", () => {
      expect(isEvent(123)).toBe(false);
    });

    it("returns false for boolean", () => {
      expect(isEvent(true)).toBe(false);
    });

    it("returns false for array", () => {
      expect(isEvent([1, 2, 3])).toBe(false);
    });
  });

  describe("when value is missing required fields", () => {
    it("returns false when aggregateId is missing", () => {
      const { aggregateId: _aggregateId, ...eventWithoutAggregateId } =
        createValidEvent();
      expect(isEvent(eventWithoutAggregateId)).toBe(false);
    });

    it("returns false when tenantId is missing", () => {
      const { tenantId: _tenantId, ...eventWithoutTenantId } =
        createValidEvent();
      expect(isEvent(eventWithoutTenantId)).toBe(false);
    });

    it("returns false when timestamp is missing", () => {
      const { timestamp: _timestamp, ...eventWithoutTimestamp } =
        createValidEvent();
      expect(isEvent(eventWithoutTimestamp)).toBe(false);
    });

    it("returns false when type is missing", () => {
      const { type: _type, ...eventWithoutType } = createValidEvent();
      expect(isEvent(eventWithoutType)).toBe(false);
    });

    it("returns false when data is missing", () => {
      const { data: _data, ...eventWithoutData } = createValidEvent();
      expect(isEvent(eventWithoutData)).toBe(false);
    });
  });

  describe("when value has wrong field types", () => {
    it("returns false when timestamp is not number", () => {
      const event = {
        ...createValidEvent(),
        timestamp: "not-a-number",
      };
      expect(isEvent(event)).toBe(false);
    });

    it("returns false when type is not string", () => {
      const event = {
        ...createValidEvent(),
        type: 123,
      };
      expect(isEvent(event)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false for empty object", () => {
      expect(isEvent({})).toBe(false);
    });

    it("returns false for object with extra fields but missing required ones", () => {
      const invalidEvent = {
        extraField: "value",
        anotherField: 123,
      };
      expect(isEvent(invalidEvent)).toBe(false);
    });

    it("returns true when all required fields present with correct types even with extra fields", () => {
      const event = {
        ...createValidEvent(),
        extraField: "value",
        anotherField: 123,
      };
      expect(isEvent(event)).toBe(true);
    });

    it("returns false when aggregateId is undefined explicitly", () => {
      const event = {
        ...createValidEvent(),
        aggregateId: undefined,
      };
      expect(isEvent(event)).toBe(false);
    });

    it("returns false when tenantId is undefined explicitly", () => {
      const event = {
        ...createValidEvent(),
        tenantId: undefined,
      };
      expect(isEvent(event)).toBe(false);
    });

    it("returns false when data is undefined explicitly", () => {
      const event = {
        ...createValidEvent(),
        data: undefined,
      };
      expect(isEvent(event)).toBe(false);
    });
  });
});

describe("isProjection", () => {
  describe("when value is a valid Projection", () => {
    it("returns true for complete valid Projection", () => {
      const projection = createValidProjection();
      expect(isProjection(projection)).toBe(true);
    });

    it("returns true for Projection with string data", () => {
      const projection = createValidProjection(
        "proj-1",
        "agg-1",
        createTenantId("tenant-1"),
        "2025-12-17",
        "string data",
      );
      expect(isProjection(projection)).toBe(true);
    });

    it("returns true for Projection with number data", () => {
      const projection = createValidProjection(
        "proj-1",
        "agg-1",
        createTenantId("tenant-1"),
        "2025-12-17",
        42,
      );
      expect(isProjection(projection)).toBe(true);
    });

    it("returns true for Projection with object data", () => {
      const projection = createValidProjection(
        "proj-1",
        "agg-1",
        createTenantId("tenant-1"),
        "2025-12-17",
        { nested: { data: "value" } },
      );
      expect(isProjection(projection)).toBe(true);
    });

    it("returns true for Projection with array data", () => {
      const projection = createValidProjection(
        "proj-1",
        "agg-1",
        createTenantId("tenant-1"),
        "2025-12-17",
        [1, 2, 3],
      );
      expect(isProjection(projection)).toBe(true);
    });

    it("returns true for Projection with null data", () => {
      const projection = createValidProjection(
        "proj-1",
        "agg-1",
        createTenantId("tenant-1"),
        "2025-12-17",
        null,
      );
      expect(isProjection(projection)).toBe(true);
    });
  });

  describe("when value is not an object", () => {
    it("returns false for null", () => {
      expect(isProjection(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isProjection(undefined)).toBe(false);
    });

    it("returns false for string", () => {
      expect(isProjection("not a projection")).toBe(false);
    });

    it("returns false for number", () => {
      expect(isProjection(123)).toBe(false);
    });

    it("returns false for boolean", () => {
      expect(isProjection(true)).toBe(false);
    });

    it("returns false for array", () => {
      expect(isProjection([1, 2, 3])).toBe(false);
    });
  });

  describe("when value is missing required fields", () => {
    it("returns false when id is missing", () => {
      const { id: _id, ...projectionWithoutId } = createValidProjection();
      expect(isProjection(projectionWithoutId)).toBe(false);
    });

    it("returns false when aggregateId is missing", () => {
      const { aggregateId: _aggregateId, ...projectionWithoutAggregateId } =
        createValidProjection();
      expect(isProjection(projectionWithoutAggregateId)).toBe(false);
    });

    it("returns false when tenantId is missing", () => {
      const { tenantId: _tenantId, ...projectionWithoutTenantId } =
        createValidProjection();
      expect(isProjection(projectionWithoutTenantId)).toBe(false);
    });

    it("returns false when version is missing", () => {
      const { version: _version, ...projectionWithoutVersion } =
        createValidProjection();
      expect(isProjection(projectionWithoutVersion)).toBe(false);
    });

    it("returns false when data is missing", () => {
      const { data: _data, ...projectionWithoutData } = createValidProjection();
      expect(isProjection(projectionWithoutData)).toBe(false);
    });
  });

  describe("when value has wrong field types", () => {
    it("returns false when id is not string", () => {
      const projection = {
        ...createValidProjection(),
        id: 123,
      };
      expect(isProjection(projection)).toBe(false);
    });

    it("returns false when version is not number", () => {
      const projection = {
        ...createValidProjection(),
        version: "not-a-number",
      };
      expect(isProjection(projection)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false for empty object", () => {
      expect(isProjection({})).toBe(false);
    });

    it("returns true when all required fields present with correct types", () => {
      const projection = {
        ...createValidProjection(),
        extraField: "value",
        anotherField: 123,
      };
      expect(isProjection(projection)).toBe(true);
    });

    it("returns false when id is undefined explicitly", () => {
      const projection = {
        ...createValidProjection(),
        id: undefined,
      };
      expect(isProjection(projection)).toBe(false);
    });

    it("returns false when aggregateId is undefined explicitly", () => {
      const projection = {
        ...createValidProjection(),
        aggregateId: undefined,
      };
      expect(isProjection(projection)).toBe(false);
    });

    it("returns false when tenantId is undefined explicitly", () => {
      const projection = {
        ...createValidProjection(),
        tenantId: undefined,
      };
      expect(isProjection(projection)).toBe(false);
    });

    it("returns false when version is undefined explicitly", () => {
      const projection = {
        ...createValidProjection(),
        version: undefined,
      };
      expect(isProjection(projection)).toBe(false);
    });

    it("returns false when data is undefined explicitly", () => {
      const projection = {
        ...createValidProjection(),
        data: undefined,
      };
      expect(isProjection(projection)).toBe(false);
    });
  });
});

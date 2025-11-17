import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventStoreClickHouse } from "../eventStoreClickHouse";
import type { Event } from "../../library";
import { createTenantId } from "../../library";
import { parse } from "@langwatch/ksuid";

describe("EventStoreClickHouse - Functional Behavior", () => {
  let mockClickHouseClient: any;
  let store: EventStoreClickHouse<string, Event<string>>;
  const tenantId = createTenantId("test-tenant");
  const aggregateType = "trace" as const;
  const context = { tenantId };

  beforeEach(() => {
    mockClickHouseClient = {
      query: vi.fn(),
      insert: vi.fn().mockResolvedValue(void 0),
    };
    store = new EventStoreClickHouse(mockClickHouseClient);
  });

  describe("getEvents()", () => {
    it("returns events in correct order (timestamp ASC, then EventId ASC)", async () => {
      const mockRows = [
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "EVENT_1",
          EventPayload: '{"value": 1}',
          ProcessingTraceparent: "trace-1",
        },
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "EVENT_2",
          EventPayload: '{"value": 2}',
          ProcessingTraceparent: "trace-2",
        },
        {
          EventTimestamp: "2024-01-01T10:00:01.000Z",
          EventType: "EVENT_3",
          EventPayload: '{"value": 3}',
          ProcessingTraceparent: "trace-3",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events).toHaveLength(3);
      expect(events[0]?.type).toBe("EVENT_1");
      expect(events[1]?.type).toBe("EVENT_2");
      expect(events[2]?.type).toBe("EVENT_3");
    });

    it("handles empty result set", async () => {
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events).toEqual([]);
      expect(Array.isArray(events)).toBe(true);
    });

    it("parses EventPayload correctly when it's a string JSON", async () => {
      const mockRows = [
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "TEST",
          EventPayload: '{"key": "value", "number": 42}',
          ProcessingTraceparent: "",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events[0]?.data).toEqual({ key: "value", number: 42 });
    });

    it("parses EventPayload correctly when it's already an object", async () => {
      const mockRows = [
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "TEST",
          EventPayload: { key: "value", number: 42 },
          ProcessingTraceparent: "",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events[0]?.data).toEqual({ key: "value", number: 42 });
    });

    it("handles empty string EventPayload", async () => {
      const mockRows = [
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "TEST",
          EventPayload: "",
          ProcessingTraceparent: "",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events[0]?.data).toEqual({});
    });

    it("handles null EventPayload", async () => {
      const mockRows = [
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "TEST",
          EventPayload: null,
          ProcessingTraceparent: "",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events[0]?.data).toEqual({});
    });

    it("handles invalid timestamp (NaN fallback)", async () => {
      const mockRows = [
        {
          EventTimestamp: "invalid-date",
          EventType: "TEST",
          EventPayload: "{}",
          ProcessingTraceparent: "",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const beforeTime = Date.now();
      const events = await store.getEvents("agg-1", context, aggregateType);
      const afterTime = Date.now();

      expect(events[0]?.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(events[0]?.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it("includes processingTraceparent in metadata", async () => {
      const mockRows = [
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "TEST",
          EventPayload: "{}",
          ProcessingTraceparent: "00-abc123-def456-01",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events[0]?.metadata?.processingTraceparent).toBe(
        "00-abc123-def456-01",
      );
    });

    it("handles empty string processingTraceparent as undefined", async () => {
      const mockRows = [
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "TEST",
          EventPayload: "{}",
          ProcessingTraceparent: "",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events[0]?.metadata?.processingTraceparent).toBeUndefined();
    });

    it("handles missing ProcessingTraceparent column", async () => {
      const mockRows = [
        {
          EventTimestamp: "2024-01-01T10:00:00.000Z",
          EventType: "TEST",
          EventPayload: "{}",
        },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const events = await store.getEvents("agg-1", context, aggregateType);

      expect(events[0]?.metadata?.processingTraceparent).toBeUndefined();
    });

    it("handles SQL injection attempts in aggregateId", async () => {
      const maliciousId = "'; DROP TABLE event_log; --";
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await store.getEvents(maliciousId, context, aggregateType);

      // Should use parameterized query, not string concatenation
      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query).toContain("{aggregateId:String}");
      expect(queryCall[0].query_params.aggregateId).toBe(maliciousId);
    });

    it("handles very long aggregateId", async () => {
      const longId = "a".repeat(10000);
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await store.getEvents(longId, context, aggregateType);

      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query_params.aggregateId).toBe(longId);
    });

    it("handles special characters in aggregateId", async () => {
      const specialId = "agg-🚀-@#$%-unicode-测试";
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await store.getEvents(specialId, context, aggregateType);

      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query_params.aggregateId).toBe(specialId);
    });

    it("handles error and logs correctly", async () => {
      const error = new Error("Database error");
      mockClickHouseClient.query.mockRejectedValue(error);

      await expect(
        store.getEvents("agg-1", context, aggregateType),
      ).rejects.toThrow("Database error");
    });
  });

  describe("storeEvents()", () => {
    it("successfully stores events", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: { value: 1 },
          tenantId,
          metadata: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      expect(mockClickHouseClient.insert).toHaveBeenCalled();
      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].table).toBe("event_log");
      expect(insertCall[0].values).toHaveLength(1);
    });

    it("generates unique EventIds", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {},
        },
        {
          aggregateId: "agg-1",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      const values = insertCall[0].values;
      expect(values[0].EventId).toBeDefined();
      expect(values[1].EventId).toBeDefined();
      expect(values[0].EventId).not.toBe(values[1].EventId);
    });

    it("generates valid UUID v4 format EventIds", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      const eventId = insertCall[0].values[0].EventId;
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(eventId).toMatch(uuidRegex);
    });

    it("stores correct tenant, aggregateType, aggregateId", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      const value = insertCall[0].values[0];
      expect(value.TenantId).toBe(tenantId);
      expect(value.AggregateType).toBe(aggregateType);
      expect(value.AggregateId).toBe("agg-1");
    });

    it("handles processingTraceparent", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {
            processingTraceparent: "00-abc123-def456-01",
          },
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      const value = insertCall[0].values[0];
      expect(value.ProcessingTraceparent).toBe("00-abc123-def456-01");
    });

    it("handles undefined processingTraceparent as empty string", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      const value = insertCall[0].values[0];
      expect(value.ProcessingTraceparent).toBe("");
    });

    it("handles batch insert with mixed aggregateIds", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {},
        },
        {
          aggregateId: "agg-2",
          timestamp: 1001,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      expect(insertCall[0].values).toHaveLength(2);
      expect(insertCall[0].values[0].AggregateId).toBe("agg-1");
      expect(insertCall[0].values[1].AggregateId).toBe("agg-2");
    });

    it("serializes event data to JSON", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: { key: "value", number: 42, nested: { foo: "bar" } },
          tenantId,
          metadata: {},
        },
      ];

      await store.storeEvents(events, context, aggregateType);

      const insertCall = mockClickHouseClient.insert.mock.calls[0];
      const payload = insertCall[0].values[0].EventPayload;
      expect(typeof payload).toBe("object");
      expect(payload).toEqual({
        key: "value",
        number: 42,
        nested: { foo: "bar" },
      });
    });

    it("handles error and logs correctly", async () => {
      const error = new Error("Insert failed");
      mockClickHouseClient.insert.mockRejectedValue(error);

      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          tenantId,
          metadata: {},
        },
      ];

      await expect(
        store.storeEvents(events, context, aggregateType),
      ).rejects.toThrow("Insert failed");
    });

    it("errors when no tenant id is present on the event", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          // tenantId is missing
        } as any,
      ];

      await expect(
        store.storeEvents(events, context, aggregateType),
      ).rejects.toThrow("[SECURITY] Event at index 0 has no tenantId");
    });

    it("errors when the context tenant id does not match the event tenant id", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "TEST" as any,
          data: {},
          tenantId: createTenantId("other-tenant"),
          metadata: {},
        },
      ];

      await expect(
        store.storeEvents(events, context, aggregateType),
      ).rejects.toThrow(
        "[SECURITY] Event at index 0 has tenantId 'other-tenant' that does not match context tenantId 'test-tenant'",
      );
    });
  });

  describe("listAggregateIds()", () => {
    it("returns distinct aggregate IDs", async () => {
      const mockRows = [
        { AggregateId: "agg-1" },
        { AggregateId: "agg-2" },
        { AggregateId: "agg-3" },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const result = await store.listAggregateIds(context, aggregateType);

      expect(result.aggregateIds).toEqual(["agg-1", "agg-2", "agg-3"]);
      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("SELECT DISTINCT AggregateId"),
        }),
      );
    });

    it("handles pagination with limit", async () => {
      const mockRows = [{ AggregateId: "agg-1" }, { AggregateId: "agg-2" }];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const result = await store.listAggregateIds(
        context,
        aggregateType,
        undefined,
        2,
      );

      expect(result.aggregateIds).toHaveLength(2);
      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query_params.limit).toBe(2);
    });

    it("handles cursor-based pagination", async () => {
      const mockRows = [{ AggregateId: "agg-2" }, { AggregateId: "agg-3" }];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      await store.listAggregateIds(context, aggregateType, "agg-1", 100);

      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query).toContain("AND AggregateId > {cursor:String}");
      expect(queryCall[0].query_params.cursor).toBe("agg-1");
    });

    it("handles empty string cursor", async () => {
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await store.listAggregateIds(context, aggregateType, "", 100);

      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query).not.toContain("AND AggregateId >");
    });

    it("returns nextCursor when exactly limit results", async () => {
      const mockRows = [
        { AggregateId: "agg-1" },
        { AggregateId: "agg-2" },
        { AggregateId: "agg-3" },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const result = await store.listAggregateIds(
        context,
        aggregateType,
        undefined,
        3,
      );

      expect(result.nextCursor).toBe("agg-3");
    });

    it("returns undefined nextCursor when less than limit results", async () => {
      const mockRows = [{ AggregateId: "agg-1" }, { AggregateId: "agg-2" }];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      const result = await store.listAggregateIds(
        context,
        aggregateType,
        undefined,
        3,
      );

      expect(result.nextCursor).toBeUndefined();
    });

    it("handles empty result set", async () => {
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      const result = await store.listAggregateIds(context, aggregateType);

      expect(result.aggregateIds).toEqual([]);
      expect(result.nextCursor).toBeUndefined();
    });

    it("handles cursor with special characters", async () => {
      const specialCursor = "agg-🚀-@#$";
      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await store.listAggregateIds(context, aggregateType, specialCursor, 100);

      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query_params.cursor).toBe(specialCursor);
    });

    it("sorts aggregate IDs in ASC order", async () => {
      const mockRows = [
        { AggregateId: "agg-3" },
        { AggregateId: "agg-1" },
        { AggregateId: "agg-2" },
      ];

      mockClickHouseClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockRows),
      });

      await store.listAggregateIds(context, aggregateType);

      // ClickHouse should return sorted, but we verify the query
      const queryCall = mockClickHouseClient.query.mock.calls[0];
      expect(queryCall[0].query).toContain("ORDER BY AggregateId ASC");
    });

    it("handles error and logs correctly", async () => {
      const error = new Error("Query failed");
      mockClickHouseClient.query.mockRejectedValue(error);

      await expect(
        store.listAggregateIds(context, aggregateType),
      ).rejects.toThrow("Query failed");
    });
  });
});

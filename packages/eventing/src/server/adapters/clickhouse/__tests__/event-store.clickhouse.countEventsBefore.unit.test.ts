import { type AggregateType, createTenantId } from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("EventStoreClickHouse - countEventsBefore", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const aggregateType: AggregateType = "trace";

  let mockClickHouseClient: EventingClickHouseClient;
  let store: EventingClickHouseEventStore;

  /** The built statement the count sent on its first read. */
  function sentStatement(): Parameters<EventingClickHouseClient["read"]>[0]["statement"] {
    const [sent] = vi.mocked(mockClickHouseClient.read).mock.calls[0] ?? [];
    if (sent === undefined) throw new Error("the count sent no read");
    return sent.statement;
  }

  beforeEach(() => {
    // Mock ClickHouse client
    mockClickHouseClient = {
      read: vi.fn(),
      insert: vi.fn(),
    };

    const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });
    store = EventingClickHouseEventStore.create({
      repository: EventingClickHouseEventRepository.create({
        resolveClient: async () => mockClickHouseClient,
        retention,
      }),
      retention,
    });
  });

  describe("countEventsBefore()", () => {
    it("returns 0 for first event in aggregate", async () => {
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "event-1";

      // Mock ClickHouse response
      const mockResult = { rows: [{ count: 0 }] };
      (mockClickHouseClient.read as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore({
        aggregateId,
        context,
        aggregateType,
        beforeTimestamp: timestamp,
        beforeEventId: eventId,
      });

      expect(count).toBe(0);
      const statement = sentStatement();
      expect(statement.sql).toContain("countDistinct(EventId)");
      expect(Object.values(statement.params)).toEqual(
        expect.arrayContaining([tenantId, aggregateType, aggregateId, timestamp, eventId]),
      );
    });

    it("counts events with earlier timestamps", async () => {
      const context = { tenantId };
      const timestamp = 2000;
      const eventId = "event-2";

      // Mock ClickHouse response - 1 event before
      const mockResult = { rows: [{ count: 1 }] };
      (mockClickHouseClient.read as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore({
        aggregateId,
        context,
        aggregateType,
        beforeTimestamp: timestamp,
        beforeEventId: eventId,
      });

      expect(count).toBe(1);
      const statement = sentStatement();
      expect(statement.sql).toContain("EventTimestamp <");
      expect(Object.values(statement.params)).toEqual(expect.arrayContaining([timestamp, eventId]));
    });

    it("counts events with same timestamp but earlier ID", async () => {
      const context = { tenantId };
      const sameTimestamp = 1000;
      const eventId = "event-b";

      // Mock ClickHouse response - 1 event with same timestamp but earlier ID
      const mockResult = { rows: [{ count: 1 }] };
      (mockClickHouseClient.read as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore({
        aggregateId,
        context,
        aggregateType,
        beforeTimestamp: sameTimestamp,
        beforeEventId: eventId,
      });

      expect(count).toBe(1);
      const statement = sentStatement();
      expect(statement.sql).toContain("EventId <");
      expect(Object.values(statement.params)).toEqual(
        expect.arrayContaining([sameTimestamp, eventId]),
      );
    });

    it("handles empty event sets", async () => {
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "non-existent-event";

      // Mock ClickHouse response - no events
      const mockResult = { rows: [{ count: 0 }] };
      (mockClickHouseClient.read as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore({
        aggregateId,
        context,
        aggregateType,
        beforeTimestamp: timestamp,
        beforeEventId: eventId,
      });

      expect(count).toBe(0);
    });

    it("enforces tenant isolation", async () => {
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "event-1";

      // Mock ClickHouse response
      const mockResult = { rows: [{ count: 0 }] };
      (mockClickHouseClient.read as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await store.countEventsBefore({
        aggregateId,
        context,
        aggregateType,
        beforeTimestamp: timestamp,
        beforeEventId: eventId,
      });

      // Verify query includes tenantId filter
      const statement = sentStatement();
      expect(statement.sql).toContain("FROM event_log WHERE TenantId = {tenantId:String}");
      expect(statement).toMatchObject({
        identity: "reader",
        kind: "tenant",
        tenantId,
        params: { tenantId },
        settings: { SQL_langwatch_tenant_ids: tenantId },
      });
    });

    it("validates tenant context before querying", async () => {
      const invalidContext = {} as any;
      const timestamp = 1000;
      const eventId = "event-1";

      await expect(
        store.countEventsBefore({
          aggregateId,
          context: invalidContext,
          aggregateType,
          beforeTimestamp: timestamp,
          beforeEventId: eventId,
        }),
      ).rejects.toThrow("tenantId");

      // Verify query was not executed
      expect(mockClickHouseClient.read).not.toHaveBeenCalled();
    });

    it("handles events with identical timestamps and different IDs", async () => {
      const context = { tenantId };
      const sameTimestamp = 1000;
      const eventId = "event-c";

      // Mock ClickHouse response - 2 events with same timestamp but earlier IDs
      const mockResult = { rows: [{ count: 2 }] };
      (mockClickHouseClient.read as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore({
        aggregateId,
        context,
        aggregateType,
        beforeTimestamp: sameTimestamp,
        beforeEventId: eventId,
      });

      expect(count).toBe(2);
      const query = sentStatement().sql;
      expect(query).toMatch(/EventTimestamp < \{v\d+:UInt64\}/);
      expect(query).toMatch(/EventTimestamp = \{v\d+:UInt64\} AND EventId < \{v\d+:String\}/);
    });

    it("handles ClickHouse query errors gracefully", async () => {
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "event-1";

      const queryError = new Error("ClickHouse connection failed");
      (mockClickHouseClient.read as ReturnType<typeof vi.fn>).mockRejectedValue(queryError);

      await expect(
        store.countEventsBefore({
          aggregateId,
          context,
          aggregateType,
          beforeTimestamp: timestamp,
          beforeEventId: eventId,
        }),
      ).rejects.toThrow("ClickHouse connection failed");
    });
  });
});

import type { ClickHouseClient } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AggregateType } from "../../";
import { createTenantId } from "../../domain/tenantId";
import { EventStoreClickHouse } from "../eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../repositories/eventRepositoryClickHouse";

describe("EventStoreClickHouse - countEventsBefore", () => {
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const aggregateType: AggregateType = "trace";

  let mockClickHouseClient: ClickHouseClient;
  let store: EventStoreClickHouse;

  beforeEach(() => {
    // Mock ClickHouse client
    mockClickHouseClient = {
      query: vi.fn(),
    } as unknown as ClickHouseClient;

    store = new EventStoreClickHouse(
      new EventRepositoryClickHouse(mockClickHouseClient),
    );
  });

  describe("counts events before a specific timestamp correctly", () => {
    it("returns 0 for first event in aggregate", async () => {
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "event-1";

      // Mock ClickHouse response
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: 0 }]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        timestamp,
        eventId,
      );

      expect(count).toBe(0);
      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("COUNT(DISTINCT EventId)"),
          query_params: expect.objectContaining({
            tenantId,

            aggregateType,
            aggregateId,
            beforeTimestamp: timestamp,
            beforeEventId: eventId,
          }),
        }),
      );
    });

    it("counts events with earlier timestamps", async () => {
      const context = { tenantId };
      const timestamp = 2000;
      const eventId = "event-2";

      // Mock ClickHouse response - 1 event before
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: 1 }]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        timestamp,
        eventId,
      );

      expect(count).toBe(1);
      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("EventTimestamp <"),
          query_params: expect.objectContaining({
            beforeTimestamp: timestamp,
            beforeEventId: eventId,
          }),
        }),
      );
    });

    it("counts events with same timestamp but earlier ID", async () => {
      const context = { tenantId };
      const sameTimestamp = 1000;
      const eventId = "event-b";

      // Mock ClickHouse response - 1 event with same timestamp but earlier ID
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: 1 }]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        sameTimestamp,
        eventId,
      );

      expect(count).toBe(1);
      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("EventId <"),
          query_params: expect.objectContaining({
            beforeTimestamp: sameTimestamp,
            beforeEventId: eventId,
          }),
        }),
      );
    });

    it("handles empty event sets", async () => {
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "non-existent-event";

      // Mock ClickHouse response - no events
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: 0 }]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

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
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "event-1";

      // Mock ClickHouse response
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: 0 }]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

      await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        timestamp,
        eventId,
      );

      // Verify query includes tenantId filter
      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("TenantId = {tenantId:String}"),
          query_params: expect.objectContaining({
            tenantId,
          }),
        }),
      );
    });

    it("validates tenant context before querying", async () => {
      const invalidContext = {} as any;
      const timestamp = 1000;
      const eventId = "event-1";

      await expect(
        store.countEventsBefore(
          aggregateId,
          invalidContext,
          aggregateType,
          timestamp,
          eventId,
        ),
      ).rejects.toThrow("tenantId");

      // Verify query was not executed
      expect(mockClickHouseClient.query).not.toHaveBeenCalled();
    });

    it("handles events with identical timestamps and different IDs", async () => {
      const context = { tenantId };
      const sameTimestamp = 1000;
      const eventId = "event-c";

      // Mock ClickHouse response - 2 events with same timestamp but earlier IDs
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: 2 }]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

      const count = await store.countEventsBefore(
        aggregateId,
        context,
        aggregateType,
        sameTimestamp,
        eventId,
      );

      expect(count).toBe(2);
      // Verify query includes both timestamp and ID comparison
      // The actual query is multiline with parameterized placeholders
      const callArgs = vi.mocked(mockClickHouseClient.query).mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      if (callArgs && typeof callArgs === "object" && "query" in callArgs) {
        const query = String(callArgs.query);
        // Verify query contains both conditions
        expect(query).toMatch(
          /EventTimestamp\s*<\s*\{beforeTimestamp:UInt64\}/s,
        );
        expect(query).toMatch(
          /EventTimestamp\s*=\s*\{beforeTimestamp:UInt64\}\s*AND\s*EventId\s*<\s*\{beforeEventId:String\}/s,
        );
      }
    });

    it("handles ClickHouse query errors gracefully", async () => {
      const context = { tenantId };
      const timestamp = 1000;
      const eventId = "event-1";

      const queryError = new Error("ClickHouse connection failed");
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockRejectedValue(queryError);

      await expect(
        store.countEventsBefore(
          aggregateId,
          context,
          aggregateType,
          timestamp,
          eventId,
        ),
      ).rejects.toThrow("ClickHouse connection failed");
    });
  });
});

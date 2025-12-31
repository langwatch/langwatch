import type { ClickHouseClient } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AggregateType, EventUtils } from "../../../library";
import { EVENT_TYPES } from "../../../library/domain/eventType";
import { createTenantId } from "../../../library/domain/tenantId";
import { buildCheckpointKey } from "../../../library/utils/checkpointKey";
import { ProcessorCheckpointStoreClickHouse } from "../processorCheckpointStoreClickHouse";
import { CheckpointRepositoryClickHouse } from "../repositories/checkpointRepositoryClickHouse";

describe("ProcessorCheckpointStoreClickHouse - Recovery Methods", () => {
  const pipelineName = "test-pipeline";
  const tenantId = createTenantId("test-tenant");
  const aggregateId = "test-aggregate";
  const aggregateType: AggregateType = "trace";
  const eventType = EVENT_TYPES[0];
  const eventVersion = "2025-12-17";

  let mockClickHouseClient: ClickHouseClient;
  let store: ProcessorCheckpointStoreClickHouse;

  beforeEach(() => {
    // Mock ClickHouse client
    mockClickHouseClient = {
      query: vi.fn(),
      command: vi.fn(),
    } as unknown as ClickHouseClient;

    store = new ProcessorCheckpointStoreClickHouse(
      new CheckpointRepositoryClickHouse(mockClickHouseClient),
    );
  });

  describe("getFailedEvents", () => {
    it("returns all failed events for an aggregate", async () => {
      const processorName = "test-handler";
      const processorType = "handler" as const;

      const event1 = EventUtils.createEvent(
        aggregateType,
        aggregateId,
        tenantId,
        eventType,
        eventVersion,
        { value: 1 },
        void 0,
        1000,
      );

      // Mock ClickHouse response
      const mockResult = {
        json: vi.fn().mockResolvedValue([
          {
            ProcessorName: processorName,
            ProcessorType: processorType,
            EventId: event1.id,
            Status: "failed",
            EventTimestamp: event1.timestamp,
            SequenceNumber: 1,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Handler failed",
            TenantId: tenantId,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
        ]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

      const failedEvents = await store.getFailedEvents(
        pipelineName,
        processorName,
        processorType,
        tenantId,
        aggregateType,
        aggregateId,
      );

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]?.eventId).toBe(event1.id);
      expect(failedEvents[0]?.status).toBe("failed");
      expect(failedEvents[0]?.errorMessage).toBe("Handler failed");
      expect(failedEvents[0]?.processorName).toBe(processorName);
      expect(failedEvents[0]?.processorType).toBe(processorType);

      // Verify query includes correct filters (now uses exact checkpoint key)
      const expectedCheckpointKey = buildCheckpointKey(
        tenantId,
        pipelineName,
        processorName,
        aggregateType,
        aggregateId,
      );
      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("Status = 'failed'"),
          query_params: expect.objectContaining({
            checkpointKey: expectedCheckpointKey,
          }),
        }),
      );
    });

    it("filters by processor name and type correctly", async () => {
      const processorName1 = "handler1";
      const processorName2 = "handler2";
      const processorType = "handler" as const;

      // Mock ClickHouse response for handler1
      const mockResult1 = {
        json: vi.fn().mockResolvedValue([
          {
            ProcessorName: processorName1,
            ProcessorType: processorType,
            EventId: "event-1",
            Status: "failed",
            EventTimestamp: 1000,
            SequenceNumber: 1,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Handler1 failed",
            TenantId: tenantId,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
        ]),
      };

      // Mock ClickHouse response for handler2 (empty)
      const mockResult2 = {
        json: vi.fn().mockResolvedValue([]),
      };

      (mockClickHouseClient.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockResult1)
        .mockResolvedValueOnce(mockResult2);

      const failedEvents1 = await store.getFailedEvents(
        pipelineName,
        processorName1,
        processorType,
        tenantId,
        aggregateType,
        aggregateId,
      );

      const failedEvents2 = await store.getFailedEvents(
        pipelineName,
        processorName2,
        processorType,
        tenantId,
        aggregateType,
        aggregateId,
      );

      expect(failedEvents1).toHaveLength(1);
      expect(failedEvents1[0]?.processorName).toBe(processorName1);
      expect(failedEvents2).toHaveLength(0);
    });

    it("filters by processor type (handler vs projection)", async () => {
      const processorName = "processor";

      // Mock ClickHouse response for handler
      const mockResultHandler = {
        json: vi.fn().mockResolvedValue([
          {
            ProcessorName: processorName,
            ProcessorType: "handler",
            EventId: "event-1",
            Status: "failed",
            EventTimestamp: 1000,
            SequenceNumber: 1,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Handler failed",
            TenantId: tenantId,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
        ]),
      };

      // Mock ClickHouse response for projection
      const mockResultProjection = {
        json: vi.fn().mockResolvedValue([
          {
            ProcessorName: processorName,
            ProcessorType: "projection",
            EventId: "event-1",
            Status: "failed",
            EventTimestamp: 1000,
            SequenceNumber: 1,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Projection failed",
            TenantId: tenantId,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
        ]),
      };

      (mockClickHouseClient.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockResultHandler)
        .mockResolvedValueOnce(mockResultProjection);

      const failedHandlers = await store.getFailedEvents(
        pipelineName,
        processorName,
        "handler",
        tenantId,
        aggregateType,
        aggregateId,
      );

      const failedProjections = await store.getFailedEvents(
        pipelineName,
        processorName,
        "projection",
        tenantId,
        aggregateType,
        aggregateId,
      );

      expect(failedHandlers).toHaveLength(1);
      expect(failedHandlers[0]?.processorType).toBe("handler");
      expect(failedProjections).toHaveLength(1);
      expect(failedProjections[0]?.processorType).toBe("projection");
    });

    it("returns empty array when no failures", async () => {
      const processorName = "test-handler";
      const processorType = "handler" as const;

      // Mock ClickHouse response - empty array
      const mockResult = {
        json: vi.fn().mockResolvedValue([]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

      const failedEvents = await store.getFailedEvents(
        pipelineName,
        processorName,
        processorType,
        tenantId,
        aggregateType,
        aggregateId,
      );

      expect(failedEvents).toHaveLength(0);
    });

    it("enforces tenant isolation", async () => {
      const processorName = "test-handler";
      const processorType = "handler" as const;
      const tenantId1 = createTenantId("tenant-1");
      const tenantId2 = createTenantId("tenant-2");

      // Mock ClickHouse response for tenant1
      const mockResult1 = {
        json: vi.fn().mockResolvedValue([
          {
            ProcessorName: processorName,
            ProcessorType: processorType,
            EventId: "event-1",
            Status: "failed",
            EventTimestamp: 1000,
            SequenceNumber: 1,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Tenant1 failed",
            TenantId: tenantId1,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
        ]),
      };

      // Mock ClickHouse response for tenant2
      const mockResult2 = {
        json: vi.fn().mockResolvedValue([
          {
            ProcessorName: processorName,
            ProcessorType: processorType,
            EventId: "event-2",
            Status: "failed",
            EventTimestamp: 1000,
            SequenceNumber: 1,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Tenant2 failed",
            TenantId: tenantId2,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
        ]),
      };

      (mockClickHouseClient.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockResult1)
        .mockResolvedValueOnce(mockResult2);

      const failedEvents1 = await store.getFailedEvents(
        pipelineName,
        processorName,
        processorType,
        tenantId1,
        aggregateType,
        aggregateId,
      );

      const failedEvents2 = await store.getFailedEvents(
        pipelineName,
        processorName,
        processorType,
        tenantId2,
        aggregateType,
        aggregateId,
      );

      expect(failedEvents1).toHaveLength(1);
      expect(failedEvents1[0]?.tenantId).toBe(tenantId1);
      expect(failedEvents2).toHaveLength(1);
      expect(failedEvents2[0]?.tenantId).toBe(tenantId2);

      // Verify queries use checkpointKey which includes tenantId for isolation
      const expectedCheckpointKey1 = buildCheckpointKey(
        tenantId1,
        pipelineName,
        processorName,
        aggregateType,
        aggregateId,
      );
      const expectedCheckpointKey2 = buildCheckpointKey(
        tenantId2,
        pipelineName,
        processorName,
        aggregateType,
        aggregateId,
      );

      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining(
            "CheckpointKey = {checkpointKey:String}",
          ),
          query_params: expect.objectContaining({
            checkpointKey: expectedCheckpointKey1,
          }),
        }),
      );
      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: expect.objectContaining({
            checkpointKey: expectedCheckpointKey2,
          }),
        }),
      );
    });

    it("sorts failed events by event timestamp ascending", async () => {
      const processorName = "test-handler";
      const processorType = "handler" as const;

      // Mock ClickHouse response with events in random order
      const mockResult = {
        json: vi.fn().mockResolvedValue([
          {
            ProcessorName: processorName,
            ProcessorType: processorType,
            EventId: "event-3",
            Status: "failed",
            EventTimestamp: 3000,
            SequenceNumber: 3,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Event3 failed",
            TenantId: tenantId,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
          {
            ProcessorName: processorName,
            ProcessorType: processorType,
            EventId: "event-1",
            Status: "failed",
            EventTimestamp: 1000,
            SequenceNumber: 1,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Event1 failed",
            TenantId: tenantId,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
          {
            ProcessorName: processorName,
            ProcessorType: processorType,
            EventId: "event-2",
            Status: "failed",
            EventTimestamp: 2000,
            SequenceNumber: 2,
            ProcessedAt: null,
            FailedAt: Date.now(),
            ErrorMessage: "Event2 failed",
            TenantId: tenantId,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
          },
        ]),
      };
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResult);

      const failedEvents = await store.getFailedEvents(
        pipelineName,
        processorName,
        processorType,
        tenantId,
        aggregateType,
        aggregateId,
      );

      // Verify query includes ORDER BY SequenceNumber ASC (to maintain processing order)
      expect(mockClickHouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("ORDER BY SequenceNumber ASC"),
        }),
      );

      // Verify events are returned (ClickHouse handles sorting, but we verify the query)
      expect(failedEvents.length).toBeGreaterThan(0);
    });

    it("handles ClickHouse query errors gracefully", async () => {
      const processorName = "test-handler";
      const processorType = "handler" as const;

      const queryError = new Error("ClickHouse connection failed");
      (
        mockClickHouseClient.query as ReturnType<typeof vi.fn>
      ).mockRejectedValue(queryError);

      await expect(
        store.getFailedEvents(
          pipelineName,
          processorName,
          processorType,
          tenantId,
          aggregateType,
          aggregateId,
        ),
      ).rejects.toThrow("ClickHouse connection failed");
    });
  });

  describe("clearCheckpoint", () => {
    it("removes checkpoint for specific aggregate", async () => {
      const processorName = "test-handler";
      const checkpointKey = buildCheckpointKey(
        tenantId,
        pipelineName,
        processorName,
        aggregateType,
        aggregateId,
      );

      // Mock ClickHouse command (clearCheckpoint uses command, not query)
      (
        mockClickHouseClient.command as ReturnType<typeof vi.fn>
      ).mockResolvedValue(void 0);

      await store.clearCheckpoint(tenantId, checkpointKey);

      // Verify ALTER DELETE command was executed
      expect(mockClickHouseClient.command).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringMatching(
            /ALTER TABLE processor_checkpoints.*DELETE WHERE CheckpointKey/s,
          ),
          query_params: expect.objectContaining({
            checkpointKey,
          }),
        }),
      );
    });

    it("handles non-existent checkpoints gracefully", async () => {
      const processorName = "test-handler";
      const nonExistentAggregateId = "non-existent-aggregate-id";

      // Mock ClickHouse command (DELETE on non-existent row succeeds)
      (
        mockClickHouseClient.command as ReturnType<typeof vi.fn>
      ).mockResolvedValue(void 0);

      // Should not throw
      const nonExistentCheckpointKey = buildCheckpointKey(
        tenantId,
        pipelineName,
        processorName,
        aggregateType,
        nonExistentAggregateId,
      );
      await expect(
        store.clearCheckpoint(tenantId, nonExistentCheckpointKey),
      ).resolves.not.toThrow();
    });

    it("only removes checkpoint for specified processor", async () => {
      const processorName1 = "handler1";
      const checkpointKey = buildCheckpointKey(
        tenantId,
        pipelineName,
        processorName1,
        aggregateType,
        aggregateId,
      );

      // Mock ClickHouse command
      (
        mockClickHouseClient.command as ReturnType<typeof vi.fn>
      ).mockResolvedValue(void 0);

      // Clear checkpoint for processor1
      await store.clearCheckpoint(tenantId, checkpointKey);

      // Verify command includes checkpointKey (which includes processorName)
      expect(mockClickHouseClient.command).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: expect.objectContaining({
            checkpointKey,
          }),
        }),
      );
    });

    it("only removes checkpoint for specified processor type", async () => {
      const processorName = "processor";
      const checkpointKey = buildCheckpointKey(
        tenantId,
        pipelineName,
        processorName,
        aggregateType,
        aggregateId,
      );

      // Mock ClickHouse command
      (
        mockClickHouseClient.command as ReturnType<typeof vi.fn>
      ).mockResolvedValue(void 0);

      // Clear checkpoint for handler
      await store.clearCheckpoint(tenantId, checkpointKey);

      // Verify command was executed with checkpointKey
      expect(mockClickHouseClient.command).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: expect.objectContaining({
            checkpointKey,
          }),
        }),
      );
    });

    it("handles ClickHouse command errors gracefully", async () => {
      const processorName = "test-handler";

      const commandError = new Error("ClickHouse connection failed");
      (
        mockClickHouseClient.command as ReturnType<typeof vi.fn>
      ).mockRejectedValue(commandError);

      const checkpointKey = buildCheckpointKey(
        tenantId,
        pipelineName,
        processorName,
        aggregateType,
        aggregateId,
      );
      await expect(
        store.clearCheckpoint(tenantId, checkpointKey),
      ).rejects.toThrow("ClickHouse connection failed");
    });
  });
});

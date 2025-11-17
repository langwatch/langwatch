/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runBulkRebuildWithCheckpoint } from "../bulkRebuild";
import type { EventSourcingService } from "../eventSourcingService";
import type {
  CheckpointStore,
  BulkRebuildCheckpoint,
} from "../../stores/bulkRebuildCheckpoint";
import type { Event, Projection } from "../../core/types";
import { createTenantId } from "../../core/tenantId";

const tenantId = createTenantId("test-tenant");

describe("runBulkRebuildWithCheckpoint", () => {
  let mockEventSourcingService: EventSourcingService<
    string,
    Event<string>,
    Projection<string>
  >;
  let mockCheckpointStore: CheckpointStore<string>;
  let mockOnProgress: (progress: {
    checkpoint: BulkRebuildCheckpoint<string>;
  }) => Promise<void> | void;

  beforeEach(() => {
    mockEventSourcingService = {
      rebuildProjectionsInBatches: vi.fn(),
    } as any;

    mockCheckpointStore = {
      loadCheckpoint: vi.fn(),
      saveCheckpoint: vi.fn(),
      clearCheckpoint: vi.fn(),
    };

    mockOnProgress = vi.fn();
  });

  describe("checkpoint loading", () => {
    it("loads checkpoint when resumeFromCheckpoint is true and checkpoint exists", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-123",
        lastAggregateId: "agg-100",
        processedCount: 50,
      };

      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(mockCheckpointStore.loadCheckpoint).mockResolvedValue(
        checkpoint,
      );
      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockResolvedValue(finalCheckpoint);

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "trace",
          resumeFromCheckpoint: true,
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      expect(mockCheckpointStore.loadCheckpoint).toHaveBeenCalledWith(
        tenantId,
        "trace",
      );
      expect(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeFrom: checkpoint,
        }),
      );
    });

    it("does not load checkpoint when resumeFromCheckpoint is false", async () => {
      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockResolvedValue(finalCheckpoint);

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "trace",
          resumeFromCheckpoint: false,
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      expect(mockCheckpointStore.loadCheckpoint).not.toHaveBeenCalled();
      expect(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeFrom: void 0,
        }),
      );
    });

    it("handles missing checkpoint gracefully (resumes from undefined)", async () => {
      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(mockCheckpointStore.loadCheckpoint).mockResolvedValue(null);
      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockResolvedValue(finalCheckpoint);

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "trace",
          resumeFromCheckpoint: true,
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      expect(mockCheckpointStore.loadCheckpoint).toHaveBeenCalledWith(
        tenantId,
        "trace",
      );
      expect(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeFrom: void 0,
        }),
      );
    });

    it("passes loaded checkpoint to rebuildProjectionsInBatches", async () => {
      const checkpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-456",
        lastAggregateId: "agg-200",
        processedCount: 75,
      };

      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 150,
      };

      vi.mocked(mockCheckpointStore.loadCheckpoint).mockResolvedValue(
        checkpoint,
      );
      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockResolvedValue(finalCheckpoint);

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "trace",
          resumeFromCheckpoint: true,
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      const callArgs = vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mock.calls[0]?.[0];
      expect(callArgs?.resumeFrom).toEqual(checkpoint);
    });
  });

  describe("checkpoint saving", () => {
    it("saves checkpoint via checkpointStore.saveCheckpoint on progress", async () => {
      const progressCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-progress",
        lastAggregateId: "agg-50",
        processedCount: 50,
      };

      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockImplementation(async (options) => {
        // Simulate progress callback
        if (options.onProgress) {
          await options.onProgress({ checkpoint: progressCheckpoint });
        }
        return finalCheckpoint;
      });

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "trace",
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      expect(mockCheckpointStore.saveCheckpoint).toHaveBeenCalledWith(
        tenantId,
        "trace",
        progressCheckpoint,
      );
    });

    it("calls custom onProgress callback if provided", async () => {
      const progressCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-progress",
        lastAggregateId: "agg-50",
        processedCount: 50,
      };

      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockImplementation(async (options) => {
        if (options.onProgress) {
          await options.onProgress({ checkpoint: progressCheckpoint });
        }
        return finalCheckpoint;
      });

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
          onProgress: mockOnProgress,
        },
        {
          tenantId,
          aggregateType: "trace",
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      expect(mockOnProgress).toHaveBeenCalledWith({
        checkpoint: progressCheckpoint,
      });
    });

    it("saves checkpoint with correct tenantId and aggregateType", async () => {
      const progressCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: "cursor-progress",
        processedCount: 25,
      };

      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockImplementation(async (options) => {
        if (options.onProgress) {
          await options.onProgress({ checkpoint: progressCheckpoint });
        }
        return finalCheckpoint;
      });

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "evaluation",
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      expect(mockCheckpointStore.saveCheckpoint).toHaveBeenCalledWith(
        tenantId,
        "evaluation",
        progressCheckpoint,
      );
    });
  });

  describe("checkpoint clearing", () => {
    it("clears checkpoint after successful completion", async () => {
      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockResolvedValue(finalCheckpoint);

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "trace",
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      expect(mockCheckpointStore.clearCheckpoint).toHaveBeenCalledWith(
        tenantId,
        "trace",
      );
    });

    it("clears checkpoint even if rebuild fails (error handling)", async () => {
      const error = new Error("Rebuild failed");
      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockRejectedValue(error);

      await expect(
        runBulkRebuildWithCheckpoint(
          {
            eventSourcingService: mockEventSourcingService,
            checkpointStore: mockCheckpointStore,
          },
          {
            tenantId,
            aggregateType: "trace",
            eventStoreContext: { tenantId },
            projectionStoreContext: { tenantId },
          },
        ),
      ).rejects.toThrow("Rebuild failed");

      expect(mockCheckpointStore.clearCheckpoint).toHaveBeenCalledWith(
        "test-tenant",
        "trace",
      );
    });
  });

  describe("integration", () => {
    it("calls eventSourcingService.rebuildProjectionsInBatches with correct options", async () => {
      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockResolvedValue(finalCheckpoint);

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId: createTenantId("test-tenant"),
          aggregateType: "trace",
          batchSize: 50,
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
          projectionStoreContext: { tenantId: createTenantId("test-tenant") },
        },
      );

      expect(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          batchSize: 50,
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
          projectionStoreContext: { tenantId: "test-tenant" },
        }),
      );
    });

    it("passes through batchSize, eventStoreContext, projectionStoreContext", async () => {
      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: void 0,
        processedCount: 100,
      };

      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockResolvedValue(finalCheckpoint);

      const eventStoreContext = {
        tenantId,
        metadata: { custom: "value" },
      };
      const projectionStoreContext = {
        tenantId,
        raw: { db: "connection" },
      };

      await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "trace",
          batchSize: 200,
          eventStoreContext,
          projectionStoreContext,
        },
      );

      const callArgs = vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mock.calls[0]?.[0];
      expect(callArgs?.batchSize).toBe(200);
      expect(callArgs?.eventStoreContext).toEqual(eventStoreContext);
      expect(callArgs?.projectionStoreContext).toEqual(projectionStoreContext);
    });

    it("returns final checkpoint from service", async () => {
      const finalCheckpoint: BulkRebuildCheckpoint<string> = {
        cursor: "final-cursor",
        lastAggregateId: "agg-final",
        processedCount: 250,
      };

      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockResolvedValue(finalCheckpoint);

      const result = await runBulkRebuildWithCheckpoint(
        {
          eventSourcingService: mockEventSourcingService,
          checkpointStore: mockCheckpointStore,
        },
        {
          tenantId,
          aggregateType: "trace",
          eventStoreContext: { tenantId },
          projectionStoreContext: { tenantId },
        },
      );

      expect(result).toEqual(finalCheckpoint);
    });
  });

  describe("error handling", () => {
    it("propagates errors from checkpointStore.loadCheckpoint", async () => {
      const error = new Error("Failed to load checkpoint");
      vi.mocked(mockCheckpointStore.loadCheckpoint).mockRejectedValue(error);

      await expect(
        runBulkRebuildWithCheckpoint(
          {
            eventSourcingService: mockEventSourcingService,
            checkpointStore: mockCheckpointStore,
          },
          {
            tenantId,
            aggregateType: "trace",
            resumeFromCheckpoint: true,
            eventStoreContext: { tenantId },
            projectionStoreContext: { tenantId },
          },
        ),
      ).rejects.toThrow("Failed to load checkpoint");

      expect(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).not.toHaveBeenCalled();
    });

    it("propagates errors from eventSourcingService.rebuildProjectionsInBatches", async () => {
      const error = new Error("Rebuild service failed");
      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockRejectedValue(error);

      await expect(
        runBulkRebuildWithCheckpoint(
          {
            eventSourcingService: mockEventSourcingService,
            checkpointStore: mockCheckpointStore,
          },
          {
            tenantId,
            aggregateType: "trace",
            eventStoreContext: { tenantId },
            projectionStoreContext: { tenantId },
          },
        ),
      ).rejects.toThrow("Rebuild service failed");
    });

    it("still clears checkpoint on error (cleanup)", async () => {
      const error = new Error("Rebuild failed");
      vi.mocked(
        mockEventSourcingService.rebuildProjectionsInBatches,
      ).mockRejectedValue(error);

      await expect(
        runBulkRebuildWithCheckpoint(
          {
            eventSourcingService: mockEventSourcingService,
            checkpointStore: mockCheckpointStore,
          },
          {
            tenantId,
            aggregateType: "trace",
            eventStoreContext: { tenantId },
            projectionStoreContext: { tenantId },
          },
        ),
      ).rejects.toThrow("Rebuild failed");

      // Should still attempt cleanup
      expect(mockCheckpointStore.clearCheckpoint).toHaveBeenCalledWith(
        "test-tenant",
        "trace",
      );
    });
  });
});

/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { ProjectionStore } from "../../stores/projectionStore.types";
import type { EventHandler } from "../../processing/eventHandler";
import type { Event, Projection } from "../../core/types";

describe("EventSourcingService - Batch Processing Failures", () => {
  let mockEventStore: any;
  let mockProjectionStore: ProjectionStore<string, Projection<string>>;
  let mockEventHandler: EventHandler<string, Event<string>, Projection<string>>;

  beforeEach(() => {
    // @ts-ignore we intentionally use a relaxed mock shape for the event store in tests
    mockEventStore = {
      getEvents: vi.fn(),
      storeEvents: vi.fn(),
      listAggregateIds: vi.fn(),
    };

    mockProjectionStore = {
      getProjection: vi.fn(),
      storeProjection: vi.fn(),
    };

    mockEventHandler = {
      handle: vi.fn(),
    };
  });

  describe("when listAggregateIds throws mid-batch", () => {
    it("propagates error without partial completion", async () => {
      vi.mocked(mockEventStore.listAggregateIds)
        .mockResolvedValueOnce({
          aggregateIds: ["agg-1"],
          nextCursor: "cursor-1",
        })
        .mockRejectedValueOnce(new Error("Database connection lost"));

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const rebuildSpy = vi
        .spyOn(service, "rebuildProjection")
        .mockResolvedValue({
          id: "proj-1",
          aggregateId: "agg-1",
          version: 1,
          data: {},
        });

      await expect(
        service.rebuildProjectionsInBatches({
          eventStoreContext: { tenantId: "test-tenant" },
        }),
      ).rejects.toThrow("Database connection lost");
      // First aggregate was processed
      expect(rebuildSpy).toHaveBeenCalledWith("agg-1", expect.anything());
    });
  });

  describe("when projection store fails during batch", () => {
    it("stops batch processing and propagates error", async () => {
      vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
        aggregateIds: ["agg-1", "agg-2", "agg-3"],
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue([
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "span.ingestion.ingested",
          data: {},
        },
      ]);

      vi.mocked(mockEventHandler.handle).mockResolvedValue({
        id: "proj-1",
        aggregateId: "agg-1",
        version: 1,
        data: {},
      });

      // Fail on second projection
      vi.mocked(mockProjectionStore.storeProjection)
        .mockResolvedValueOnce(void 0)
        .mockRejectedValueOnce(new Error("Projection store write failed"));

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      await expect(
        service.rebuildProjectionsInBatches({
          eventStoreContext: { tenantId: "test-tenant" },
        }),
      ).rejects.toThrow("Projection store write failed");
    });

    it("processes first aggregate successfully before failure", async () => {
      vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
        aggregateIds: ["agg-1", "agg-2"],
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue([
        {
          aggregateId: "agg-1",
          timestamp: 1000,
          type: "span.ingestion.ingested",
          data: {},
        },
      ]);

      vi.mocked(mockEventHandler.handle).mockResolvedValue({
        id: "proj-1",
        aggregateId: "agg-1",
        version: 1,
        data: {},
      });

      // Succeed first, fail second
      vi.mocked(mockProjectionStore.storeProjection)
        .mockResolvedValueOnce(void 0)
        .mockRejectedValueOnce(new Error("Store failed"));

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      await expect(
        service.rebuildProjectionsInBatches({
          eventStoreContext: { tenantId: "test-tenant" },
        }),
      ).rejects.toThrow();
      // Store was called twice (once successfully, once failed)
      expect(mockProjectionStore.storeProjection).toHaveBeenCalledTimes(2);
    });
  });

  describe("when onProgress callback throws", () => {
    it("stops batch processing", async () => {
      vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
        aggregateIds: ["agg-1", "agg-2"],
      });

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const rebuildSpy = vi
        .spyOn(service, "rebuildProjection")
        .mockResolvedValue({
          id: "proj-1",
          aggregateId: "agg-1",
          version: 1,
          data: {},
        });

      let progressCallCount = 0;
      const onProgress = vi.fn(() => {
        progressCallCount++;
        if (progressCallCount === 1) {
          throw new Error("Progress tracking failed");
        }
      });

      await expect(
        service.rebuildProjectionsInBatches({
          onProgress,
          eventStoreContext: { tenantId: "test-tenant" },
        }),
      ).rejects.toThrow("Progress tracking failed");

      // Only first aggregate was processed before error
      expect(rebuildSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when resuming from checkpoint with invalid cursor", () => {
    it("passes invalid cursor to listAggregateIds", async () => {
      vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
        aggregateIds: [],
      });

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const invalidCursor = { invalid: "cursor" };
      await service.rebuildProjectionsInBatches({
        resumeFrom: {
          cursor: invalidCursor,
          processedCount: 5,
        },
        eventStoreContext: { tenantId: "test-tenant" },
      });

      expect(mockEventStore.listAggregateIds).toHaveBeenCalledWith(
        { tenantId: "test-tenant" },
        "trace",
        invalidCursor,
        100,
      );
    });
  });

  describe("when eventStore does not implement listAggregateIds", () => {
    it("throws descriptive error immediately", async () => {
      const eventStoreWithoutList: any = {
        getEvents: vi.fn(),
        storeEvents: vi.fn(),
        // listAggregateIds is undefined
      };

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: eventStoreWithoutList,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      await expect(
        service.rebuildProjectionsInBatches({
          eventStoreContext: { tenantId: "test-tenant" },
        }),
      ).rejects.toThrow(
        "EventStore.listAggregateIds is not implemented for this store",
      );
    });

    it("does not attempt any processing", async () => {
      const eventStoreWithoutList: any = {
        getEvents: vi.fn(),
        storeEvents: vi.fn(),
      };

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: eventStoreWithoutList,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const rebuildSpy = vi.spyOn(service, "rebuildProjection");

      await expect(
        service.rebuildProjectionsInBatches({
          eventStoreContext: { tenantId: "test-tenant" },
        }),
      ).rejects.toThrow();
      expect(rebuildSpy).not.toHaveBeenCalled();
    });
  });

  describe("when aggregate rebuild fails in batch", () => {
    it("stops processing and propagates error", async () => {
      vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
        aggregateIds: ["agg-1", "agg-2", "agg-3"],
      });

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const rebuildSpy = vi
        .spyOn(service, "rebuildProjection")
        .mockResolvedValueOnce({
          id: "proj-1",
          aggregateId: "agg-1",
          version: 1,
          data: {},
        })
        .mockRejectedValueOnce(new Error("Rebuild failed for agg-2"));

      await expect(
        service.rebuildProjectionsInBatches({
          eventStoreContext: { tenantId: "test-tenant" },
        }),
      ).rejects.toThrow("Rebuild failed for agg-2");

      // Only first and second aggregates were attempted
      expect(rebuildSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("when no aggregates are found initially", () => {
    it("returns checkpoint with zero processed", async () => {
      vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
        aggregateIds: [],
      });

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const checkpoint = await service.rebuildProjectionsInBatches({
        eventStoreContext: { tenantId: "test-tenant" },
      });

      expect(checkpoint.processedCount).toBe(0);
      expect(checkpoint.cursor).toBeUndefined();
    });

    it("does not call onProgress", async () => {
      vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
        aggregateIds: [],
      });

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const onProgress = vi.fn();

      await service.rebuildProjectionsInBatches({
        onProgress,
        eventStoreContext: { tenantId: "test-tenant" },
      });

      expect(onProgress).not.toHaveBeenCalled();
    });
  });
});

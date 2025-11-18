import { describe, it, expect, vi, beforeEach } from "vitest";
import { TraceProcessingCommandHandler } from "../traceProcessingCommandHandler";
import { createCommand, createTenantId } from "../../../../library";
import type {
  RebuildTraceProjectionCommand,
  ForceRebuildTraceProjectionCommand,
  BulkRebuildTraceProjectionsCommand,
} from "../../commands/traceProcessingCommand";
import { traceProcessingPipeline } from "../../pipeline";

// Mock the pipeline
vi.mock("../../pipeline", () => {
  const mockService = {
    rebuildProjection: vi.fn().mockResolvedValue(void 0),
    forceRebuildProjection: vi.fn().mockResolvedValue(void 0),
    rebuildProjectionsInBatches: vi.fn().mockResolvedValue(void 0),
  };

  return {
    traceProcessingPipeline: {
      service: mockService,
    },
  };
});

describe("TraceProcessingCommandHandler - TenantId Validation", () => {
  let handler: TraceProcessingCommandHandler;

  beforeEach(() => {
    handler = new TraceProcessingCommandHandler();
    vi.clearAllMocks();
  });

  const tenantId = createTenantId("test-tenant");

  describe("handle", () => {
    it("uses tenantId from command for rebuild projection", async () => {
      const command = createCommand(
        tenantId,
        "trace-1",
        "lw.obs.trace.projection.rebuild",
        { traceId: "trace-1", force: false },
      ) as RebuildTraceProjectionCommand;

      await handler.handle(command);

      expect(
        traceProcessingPipeline.service.rebuildProjection,
      ).toHaveBeenCalledWith("trace-1", {
        eventStoreContext: { tenantId },
        projectionStoreContext: { tenantId },
      });
    });

    it("uses tenantId from command for force rebuild", async () => {
      const command = createCommand(
        tenantId,
        "trace-1",
        "lw.obs.trace.projection.rebuild_force",
        { traceId: "trace-1" },
      ) as ForceRebuildTraceProjectionCommand;

      await handler.handle(command);

      expect(
        traceProcessingPipeline.service.forceRebuildProjection,
      ).toHaveBeenCalledWith("trace-1", {
        eventStoreContext: { tenantId },
        projectionStoreContext: { tenantId },
      });
    });

    it("uses tenantId from command for bulk rebuild", async () => {
      const command = createCommand(
        tenantId,
        "trace-1",
        "lw.obs.trace.projection.rebuild_bulk",
        {
          batchSize: 100,
          cursor: "cursor-1",
          resumeFromCount: 10,
        },
      ) as BulkRebuildTraceProjectionsCommand;

      await handler.handle(command);

      expect(
        traceProcessingPipeline.service.rebuildProjectionsInBatches,
      ).toHaveBeenCalledWith({
        batchSize: 100,
        eventStoreContext: { tenantId },
        projectionStoreContext: { tenantId },
        resumeFrom: {
          cursor: "cursor-1",
          processedCount: 10,
        },
      });
    });

    it("passes tenantId correctly when force flag is true", async () => {
      const command = createCommand(
        tenantId,
        "trace-1",
        "lw.obs.trace.projection.rebuild",
        { traceId: "trace-1", force: true },
      ) as RebuildTraceProjectionCommand;

      await handler.handle(command);

      expect(
        traceProcessingPipeline.service.forceRebuildProjection,
      ).toHaveBeenCalledWith("trace-1", {
        eventStoreContext: { tenantId },
        projectionStoreContext: { tenantId },
      });
    });

    it("handles different tenantIds correctly", async () => {
      const differentTenantId = createTenantId("different-tenant");
      const command = createCommand(
        differentTenantId,
        "trace-1",
        "lw.obs.trace.projection.rebuild",
        { traceId: "trace-1", force: false },
      ) as RebuildTraceProjectionCommand;

      await handler.handle(command);

      expect(
        traceProcessingPipeline.service.rebuildProjection,
      ).toHaveBeenCalledWith("trace-1", {
        eventStoreContext: { tenantId: differentTenantId },
        projectionStoreContext: { tenantId: differentTenantId },
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TraceProjectionEventHandler } from "../traceProjectionEventHandler";
import { EventUtils, createTenantId } from "../../../../library";
import type { SpanReadRepository } from "../../repositories/spanReadRepositoryClickHouse";
import type { SpanData } from "../../../span-processing/types";

describe("TraceProjectionEventHandler - TenantId Validation", () => {
  let mockSpanReadRepository: SpanReadRepository;
  let handler: TraceProjectionEventHandler;

  beforeEach(() => {
    // Mock at least one span to avoid "Cannot build projection from empty spans" error
    const now = Date.now();
    const mockSpan: SpanData = {
      traceId: "trace-1",
      spanId: "span-1",
      traceFlags: 1,
      traceState: null,
      isRemote: false,
      parentSpanId: null,
      name: "test-span",
      kind: 0, // SpanKind.INTERNAL
      startTimeUnixMs: now,
      endTimeUnixMs: now + 100,
      attributes: {},
      events: [],
      links: [],
      status: { code: 1, message: null },
      resourceAttributes: {},
      instrumentationScope: { name: "test", version: null },
      durationMs: 100,
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };

    mockSpanReadRepository = {
      getSpansForTrace: vi.fn().mockResolvedValue([mockSpan]),
    } as any;
    handler = new TraceProjectionEventHandler(mockSpanReadRepository);
  });

  const tenantId = createTenantId("test-tenant");

  describe("handle", () => {
    it("rejects empty event stream", async () => {
      const stream = EventUtils.createEventStream("trace-1", []);

      await expect(handler.handle(stream)).rejects.toThrow(
        "Event stream is empty",
      );
    });

    it("rejects events with missing tenantId", async () => {
      const event = EventUtils.createEvent(
        "trace-1",
        tenantId,
        "lw.obs.trace.projection.reset" as any,
        {},
      );
      // Remove tenantId to simulate missing tenantId
      const eventWithoutTenantId = {
        ...event,
        tenantId: void 0,
      } as any;

      const stream = EventUtils.createEventStream("trace-1", [
        eventWithoutTenantId,
      ]);

      await expect(handler.handle(stream)).rejects.toThrow(
        "Event has no tenantId",
      );
    });

    it("rejects events with empty tenantId", async () => {
      const event = EventUtils.createEvent(
        "trace-1",
        tenantId,
        "lw.obs.trace.projection.reset" as any,
        {},
      );
      // Set tenantId to empty string
      const eventWithEmptyTenantId = {
        ...event,
        tenantId: "",
      } as any;

      const stream = EventUtils.createEventStream("trace-1", [
        eventWithEmptyTenantId,
      ]);

      await expect(handler.handle(stream)).rejects.toThrow(
        "Event has no tenantId",
      );
    });

    it("accepts events with valid tenantId and includes it in projection", async () => {
      const event = EventUtils.createEvent(
        "trace-1",
        tenantId,
        "lw.obs.trace.projection.reset" as any,
        {},
      );

      const stream = EventUtils.createEventStream("trace-1", [event]);

      const projection = await handler.handle(stream);

      expect(String(projection.tenantId)).toBe(String(tenantId));
      expect(projection.aggregateId).toBe("trace-1");
      expect(mockSpanReadRepository.getSpansForTrace).toHaveBeenCalledWith(
        String(tenantId),
        "trace-1",
      );
    });

    it("uses tenantId from first event in stream", async () => {
      const tenant1 = createTenantId("tenant-1");
      const tenant2 = createTenantId("tenant-2");

      const event1 = EventUtils.createEvent(
        "trace-1",
        tenant1,
        "lw.obs.trace.projection.reset" as any,
        {},
      );
      const event2 = EventUtils.createEvent(
        "trace-1",
        tenant2,
        "lw.obs.trace.projection.recomputed" as any,
        {},
      );

      const stream = EventUtils.createEventStream("trace-1", [event1, event2]);

      const projection = await handler.handle(stream);

      // Should use tenantId from first event
      expect(String(projection.tenantId)).toBe(String(tenant1));
      expect(mockSpanReadRepository.getSpansForTrace).toHaveBeenCalledWith(
        String(tenant1),
        "trace-1",
      );
    });
  });
});

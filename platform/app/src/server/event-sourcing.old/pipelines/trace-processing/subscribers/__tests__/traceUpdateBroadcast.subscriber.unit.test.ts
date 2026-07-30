import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createTraceUpdateBroadcastSubscriber,
  TRACE_UPDATE_BROADCAST_DEDUP_TTL_MS,
} from "../traceUpdateBroadcast.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createEvent(
  overrides: Record<string, unknown> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "project-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: "2025-12-14",
    data: {},
    metadata: {},
    ...overrides,
  } as unknown as TraceProcessingEvent;
}

function createBroadcast(): BroadcastService {
  return {
    broadcastToTenant: vi.fn().mockResolvedValue(undefined),
  } as unknown as BroadcastService;
}

describe("createTraceUpdateBroadcastSubscriber", () => {
  let broadcast: BroadcastService;

  beforeEach(() => {
    broadcast = createBroadcast();
  });

  describe("given the default wiring", () => {
    it("registers under the traceUpdateBroadcast name", () => {
      const subscriber = createTraceUpdateBroadcastSubscriber({ broadcast });

      expect(subscriber.name).toBe("traceUpdateBroadcast");
    });

    it("subscribes to every trace-processing event type", () => {
      const subscriber = createTraceUpdateBroadcastSubscriber({ broadcast });

      expect(subscriber.eventTypes).toContain("lw.obs.trace.span_received");
      expect(subscriber.eventTypes).toContain("lw.obs.trace.topic_assigned");
      expect(subscriber.eventTypes).toContain("lw.obs.trace.origin_resolved");
      expect(subscriber.eventTypes).toContain("lw.obs.trace.annotation_added");
    });

    it("declares no enqueue filter, so nothing fallible runs on the routing path", () => {
      const subscriber = createTraceUpdateBroadcastSubscriber({ broadcast });

      expect(subscriber.options?.enqueue).toBeUndefined();
    });

    it("debounces per tenant and trace within the dedup window", () => {
      const subscriber = createTraceUpdateBroadcastSubscriber({ broadcast });
      const dedup = subscriber.options?.deduplication;

      if (typeof dedup !== "object") {
        throw new Error("expected a deduplication config");
      }
      expect(dedup.makeId(createEvent())).toBe("trace-update:project-1:trace-1");
      expect(dedup.ttlMs).toBe(TRACE_UPDATE_BROADCAST_DEDUP_TTL_MS);
    });
  });

  describe("when redis is unavailable", () => {
    it("disables the subscriber so no push is emitted into a missing bridge", () => {
      const subscriber = createTraceUpdateBroadcastSubscriber({
        broadcast,
        hasRedis: false,
      });

      expect(subscriber.options?.disabled).toBe(true);
    });
  });

  describe("when redis is available", () => {
    it("leaves the subscriber enabled", () => {
      const subscriber = createTraceUpdateBroadcastSubscriber({
        broadcast,
        hasRedis: true,
      });

      expect(subscriber.options?.disabled).toBe(false);
    });
  });

  describe("when an event is handled", () => {
    it("pushes a trace_summary_updated payload to the tenant", async () => {
      const subscriber = createTraceUpdateBroadcastSubscriber({ broadcast });

      await subscriber.handle(createEvent(), {
        tenantId: "project-1",
        aggregateId: "trace-1",
      });

      expect(broadcast.broadcastToTenant).toHaveBeenCalledWith(
        "project-1",
        JSON.stringify({ event: "trace_summary_updated", traceId: "trace-1" }),
        "trace_updated",
      );
    });

    it("addresses the push from the subscriber context, not the event body", async () => {
      const subscriber = createTraceUpdateBroadcastSubscriber({ broadcast });

      await subscriber.handle(createEvent(), {
        tenantId: "project-2",
        aggregateId: "trace-9",
      });

      expect(broadcast.broadcastToTenant).toHaveBeenCalledWith(
        "project-2",
        JSON.stringify({ event: "trace_summary_updated", traceId: "trace-9" }),
        "trace_updated",
      );
    });
  });

  describe("when the broadcast fails", () => {
    /** @scenario "A live update missed by a closed page is not redelivered" */
    it("swallows the failure so the push is never redelivered", async () => {
      broadcast.broadcastToTenant = vi
        .fn()
        .mockRejectedValue(new Error("redis down"));
      const subscriber = createTraceUpdateBroadcastSubscriber({ broadcast });

      await expect(
        subscriber.handle(createEvent(), {
          tenantId: "project-1",
          aggregateId: "trace-1",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

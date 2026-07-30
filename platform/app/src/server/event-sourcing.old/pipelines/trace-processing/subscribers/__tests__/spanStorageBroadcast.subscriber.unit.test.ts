import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createSpanStorageBroadcastSubscriber,
  SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
} from "../spanStorageBroadcast.subscriber";

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

describe("createSpanStorageBroadcastSubscriber", () => {
  let broadcast: BroadcastService;

  beforeEach(() => {
    broadcast = createBroadcast();
  });

  describe("given the default wiring", () => {
    it("registers under the spanStorageBroadcast name", () => {
      const subscriber = createSpanStorageBroadcastSubscriber({ broadcast });

      expect(subscriber.name).toBe("spanStorageBroadcast");
    });

    it("subscribes to span_received only", () => {
      const subscriber = createSpanStorageBroadcastSubscriber({ broadcast });

      expect(subscriber.eventTypes).toEqual(["lw.obs.trace.span_received"]);
    });

    it("declares no enqueue filter, so nothing fallible runs on the routing path", () => {
      const subscriber = createSpanStorageBroadcastSubscriber({ broadcast });

      expect(subscriber.options?.enqueue).toBeUndefined();
    });

    it("debounces on a key distinct from the trace-summary push", () => {
      const subscriber = createSpanStorageBroadcastSubscriber({ broadcast });
      const dedup = subscriber.options?.deduplication;

      if (typeof dedup !== "object") {
        throw new Error("expected a deduplication config");
      }
      expect(dedup.makeId(createEvent())).toBe("span-stored:project-1:trace-1");
      expect(dedup.ttlMs).toBe(SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS);
    });
  });

  describe("when redis is unavailable", () => {
    it("disables the subscriber so no push is emitted into a missing bridge", () => {
      const subscriber = createSpanStorageBroadcastSubscriber({
        broadcast,
        hasRedis: false,
      });

      expect(subscriber.options?.disabled).toBe(true);
    });
  });

  describe("when redis is available", () => {
    it("leaves the subscriber enabled", () => {
      const subscriber = createSpanStorageBroadcastSubscriber({
        broadcast,
        hasRedis: true,
      });

      expect(subscriber.options?.disabled).toBe(false);
    });
  });

  describe("when an event is handled", () => {
    it("pushes a span_stored payload to the tenant", async () => {
      const subscriber = createSpanStorageBroadcastSubscriber({ broadcast });

      await subscriber.handle(createEvent(), {
        tenantId: "project-1",
        aggregateId: "trace-1",
      });

      expect(broadcast.broadcastToTenant).toHaveBeenCalledWith(
        "project-1",
        JSON.stringify({ event: "span_stored", traceId: "trace-1" }),
        "trace_updated",
      );
    });

    it("addresses the push from the event's own tenant and aggregate", async () => {
      const subscriber = createSpanStorageBroadcastSubscriber({ broadcast });

      await subscriber.handle(
        createEvent({ tenantId: "project-2", aggregateId: "trace-9" }),
        { tenantId: "project-2", aggregateId: "trace-9" },
      );

      expect(broadcast.broadcastToTenant).toHaveBeenCalledWith(
        "project-2",
        JSON.stringify({ event: "span_stored", traceId: "trace-9" }),
        "trace_updated",
      );
    });
  });

  describe("when the broadcast fails", () => {
    it("swallows the failure so the push is never redelivered", async () => {
      broadcast.broadcastToTenant = vi
        .fn()
        .mockRejectedValue(new Error("redis down"));
      const subscriber = createSpanStorageBroadcastSubscriber({ broadcast });

      await expect(
        subscriber.handle(createEvent(), {
          tenantId: "project-1",
          aggregateId: "trace-1",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

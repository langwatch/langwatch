/**
 * A worker's pushes reaching an api's open subscriptions over one shared Redis.
 * @see modules/trace/specs/trace-tenant-broadcast-worker-composition.feature
 */
import { EventEmitter } from "node:events";

import { createApiFixture } from "@langwatch/api-fixture";
import type { PresenceApi } from "@langwatch/presence-contract";
import {
  type MemoryRedisStore,
  memoryRedisDouble,
  memoryRedisStore,
} from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { traceTenantBroadcastChannels } from "../../channels/trace-tenant-broadcast-channels.registry.ts";
import {
  TENANT_ID,
  TRACE_ID,
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "../../eventing/__tests__/trace-subscriber.fixtures.ts";
import { createSpanStorageBroadcastHandler } from "../../eventing/span-storage-broadcast.subscriber.ts";
import { createTraceUpdateBroadcastHandler } from "../../eventing/trace-update-broadcast.subscriber.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const envelopeSchema = z.object({ tenantId: z.string(), event: z.string(), timestamp: z.number() });

/** Presence's fan-out as the api runs it: one subscriber connection relaying `broadcast:*`. */
async function apiFanOut(store: MemoryRedisStore) {
  const subscriber = memoryRedisDouble({ store });
  const emitters = new Map<string, EventEmitter>();
  const released: string[] = [];
  const emitterFor = (tenantId: string): EventEmitter => {
    const existing = emitters.get(tenantId);
    if (existing) return existing;
    const created = new EventEmitter();
    emitters.set(tenantId, created);
    return created;
  };
  subscriber.on("message", (channel: string, message: string) => {
    const { tenantId, event, timestamp } = envelopeSchema.parse(JSON.parse(message));
    emitterFor(tenantId).emit(channel.replace(/^broadcast:/, ""), { event, timestamp });
  });
  await subscriber.subscribe(
    "broadcast:trace_updated",
    "broadcast:discover_updated",
    "broadcast:export_progress",
  );
  const presence = createApiFixture<PresenceApi>({
    getTenantEmitter: emitterFor,
    cleanupTenantEmitter: (tenantId: string) => {
      released.push(tenantId);
    },
  });
  return { presence, released };
}

function workerBroadcast(store: MemoryRedisStore) {
  return traceTenantBroadcastChannels.live.create(memoryRedisDouble({ store }));
}

describe("trace live updates across processes", () => {
  describe("given an api subscribed to a tenant's trace updates", () => {
    describe("when the worker's summary fold advances", () => {
      /** @scenario "A trace summary advancing reaches the channel the application subscribes to" */
      /** @scenario "The trace summary body is the one the browser already reads" */
      it("delivers main's summary body to the open subscription", async () => {
        const store = memoryRedisStore();
        const { presence } = await apiFanOut(store);
        const app = createTraceAppHarness({ broadcast: presence });
        const stream = app.streamTenantUpdates({
          projectId: TENANT_ID,
          eventName: "trace_updated",
        });
        const received = stream.next();

        await createTraceUpdateBroadcastHandler({ broadcast: workerBroadcast(store) })(
          createSpanReceivedEvent(createOtlpSpan()),
          createContext(createFoldState()),
        );

        expect((await received).value).toEqual({
          event: JSON.stringify({ event: "trace_summary_updated", traceId: TRACE_ID }),
          timestamp: expect.any(Number),
        });
        await stream.return(undefined);
      });
    });

    describe("when the worker stores a span", () => {
      /** @scenario "A span landing publishes its own body, not the summary's" */
      it("delivers the span storage body", async () => {
        const store = memoryRedisStore();
        const { presence } = await apiFanOut(store);
        const app = createTraceAppHarness({ broadcast: presence });
        const stream = app.streamTenantUpdates({
          projectId: TENANT_ID,
          eventName: "trace_updated",
        });
        const received = stream.next();

        await createSpanStorageBroadcastHandler({ broadcast: workerBroadcast(store) })(
          createSpanReceivedEvent(createOtlpSpan()),
          createContext(createFoldState()),
        );

        expect((await received).value).toEqual({
          event: JSON.stringify({ event: "span_stored", traceId: TRACE_ID }),
          timestamp: expect.any(Number),
        });
        await stream.return(undefined);
      });
    });

    describe("when the subscription's signal aborts", () => {
      /** @scenario "A closed live-update subscription releases the tenant's emitter" */
      it("ends the stream and releases the tenant's emitter", async () => {
        const store = memoryRedisStore();
        const { presence, released } = await apiFanOut(store);
        const app = createTraceAppHarness({ broadcast: presence });
        const controller = new AbortController();
        const stream = app.streamTenantUpdates({
          projectId: TENANT_ID,
          eventName: "discover_updated",
          signal: controller.signal,
        });
        const ended = stream.next();

        controller.abort();

        expect(await ended).toEqual({ done: true, value: undefined });
        expect(released).toEqual([TENANT_ID]);
      });
    });
  });

  describe("given an api subscribed to a tenant's discover refreshes", () => {
    /** @scenario "A discover refresh published by one process reaches another process's subscription" */
    it("delivers the refresh signal", async () => {
      const store = memoryRedisStore();
      const { presence } = await apiFanOut(store);
      const app = createTraceAppHarness({ broadcast: presence });
      const stream = app.streamTenantUpdates({
        projectId: TENANT_ID,
        eventName: "discover_updated",
      });
      const received = stream.next();

      await workerBroadcast(store).broadcastToTenant({
        tenantId: TENANT_ID,
        event: JSON.stringify({ event: "discover_updated", tenantId: TENANT_ID, timestamp: 1 }),
        eventType: "discover_updated",
      });

      expect((await received).value).toMatchObject({
        event: JSON.stringify({ event: "discover_updated", tenantId: TENANT_ID, timestamp: 1 }),
      });
      await stream.return(undefined);
    });
  });

  describe("given a viewer watching an export another process runs", () => {
    /** @scenario "Export progress published by another process reaches the watching viewer" */
    it("relays that export's frames until it is done", async () => {
      const store = memoryRedisStore();
      const { presence } = await apiFanOut(store);
      const app = createTraceAppHarness({ broadcast: presence });
      const frames: unknown[] = [];
      const watching = (async () => {
        for await (const frame of app.streamExportProgress({
          projectId: TENANT_ID,
          exportId: "export-1",
        })) {
          frames.push(frame);
        }
      })();
      await Promise.resolve();
      const exporter = memoryRedisDouble({ store });

      for (const frame of [
        { exportId: "export-1", type: "progress", exported: 1, total: 2 },
        { exportId: "export-1", type: "done", exported: 2, total: 2 },
      ]) {
        await exporter.publish(
          "broadcast:export_progress",
          JSON.stringify({ tenantId: TENANT_ID, event: JSON.stringify(frame), timestamp: 1 }),
        );
      }
      await watching;

      expect(frames).toEqual([
        { exportId: "export-1", type: "progress", exported: 1, total: 2 },
        { exportId: "export-1", type: "done", exported: 2, total: 2 },
      ]);
    });
  });
});

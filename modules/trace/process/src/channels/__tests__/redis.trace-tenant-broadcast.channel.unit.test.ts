/** @see modules/trace/specs/trace-tenant-broadcast-worker-composition.feature */
import { describe, expect, it } from "vitest";

import {
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "../../eventing/__tests__/trace-subscriber.fixtures.ts";
import { createTraceUpdateBroadcastHandler } from "../../eventing/trace-update-broadcast.subscriber.ts";
import { RedisTraceTenantBroadcastChannel } from "../redis/redis.trace-tenant-broadcast.channel.ts";

function recordingPublisher() {
  const published: { channel: string; message: string }[] = [];
  return {
    published,
    publish: async (channel: string, message: string) => {
      published.push({ channel, message });
      return 1;
    },
  };
}

describe("RedisTraceTenantBroadcastChannel", () => {
  describe("when a trace update is published", () => {
    /** @scenario "The envelope carries the tenant and the producer's payload verbatim" */
    it("writes main's tenant envelope on the channel presence subscribes to", async () => {
      const publisher = recordingPublisher();
      const channel = RedisTraceTenantBroadcastChannel.create(publisher);

      await channel.broadcastToTenant({
        tenantId: "project-1",
        event: '{"event":"span_stored","traceId":"trace-1"}',
        eventType: "trace_updated",
      });

      expect(publisher.published).toHaveLength(1);
      expect(publisher.published[0]?.channel).toBe("broadcast:trace_updated");
      expect(JSON.parse(publisher.published[0]?.message ?? "")).toEqual({
        tenantId: "project-1",
        event: '{"event":"span_stored","traceId":"trace-1"}',
        timestamp: expect.any(Number),
      });
    });

    it("publishes a discover refresh on its own channel", async () => {
      const publisher = recordingPublisher();
      const channel = RedisTraceTenantBroadcastChannel.create(publisher);

      await channel.broadcastToTenant({
        tenantId: "project-1",
        event: "{}",
        eventType: "discover_updated",
      });

      expect(publisher.published[0]?.channel).toBe("broadcast:discover_updated");
    });
  });

  describe("when Redis refuses the publish", () => {
    /** @scenario "A failed publish does not fail the ingestion that caused it" */
    it("completes the subscriber that asked for it", async () => {
      const handler = createTraceUpdateBroadcastHandler({
        broadcast: RedisTraceTenantBroadcastChannel.create({
          publish: () => Promise.reject(new Error("redis down")),
        }),
      });

      await expect(
        handler(createSpanReceivedEvent(createOtlpSpan()), createContext(createFoldState())),
      ).resolves.toBeUndefined();
    });
  });
});

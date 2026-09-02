import type { RedisConnection } from "@langwatch/redis-client";
import { describe, expect, it } from "vitest";
import { tryCreateWorkerTenantBroadcast } from "../worker-tenant-broadcast.composition";

/**
 * Spec: packages/features/notification/specs/tenant-broadcast-twin.feature
 *
 * A COMPOSITION-CAPABILITY test: the three pipelines that will publish through
 * this are still registered by the application, so nothing in this process
 * broadcasts yet. What has to be true today is that this composition root can
 * build the publisher from the Redis it already holds, and that it says so when
 * it holds none.
 */
class FakeRedis {
  readonly published: Array<[string, string]> = [];

  async publish(channel: string, message: string): Promise<number> {
    this.published.push([channel, message]);
    return 1;
  }
}

describe("tryCreateWorkerTenantBroadcast", () => {
  describe("given the Redis this process already holds", () => {
    /** @scenario "The channel is the event type, prefixed" */
    it("publishes onto the channel the application subscribes to", async () => {
      const redis = new FakeRedis();

      const broadcast = tryCreateWorkerTenantBroadcast({
        redis: redis as unknown as RedisConnection,
      });
      await broadcast!.broadcastToTenant({
        tenantId: "project-1",
        event: "{}",
        eventType: "trace_updated",
      });

      expect(redis.published.map(([channel]) => channel)).toEqual(["broadcast:trace_updated"]);
      expect(JSON.parse(redis.published[0]![1]) as object).toMatchObject({
        tenantId: "project-1",
        event: "{}",
      });
    });
  });

  describe("given a deployment with no Redis", () => {
    /** @scenario "A publish that fails does not fail the work that caused it" */
    it("reports that this process cannot broadcast rather than accepting one", () => {
      expect(tryCreateWorkerTenantBroadcast({ redis: null })).toBeUndefined();
    });
  });
});

import { describe, expect, it } from "vitest";

import { RedisScenarioEventBroadcastChannel } from "../redis/redis.scenario-event-broadcast.channel.ts";

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

describe("RedisScenarioEventBroadcastChannel", () => {
  describe("when a simulation update is published", () => {
    it("writes main's tenant envelope on the broadcast channel the fan-out subscribes to", async () => {
      const publisher = recordingPublisher();
      const channel = RedisScenarioEventBroadcastChannel.create(publisher);

      await channel.broadcastToTenant({
        projectId: "project-1",
        message: '{"event":"simulation_updated"}',
        eventType: "simulation_updated",
      });

      expect(publisher.published).toHaveLength(1);
      expect(publisher.published[0]?.channel).toBe("broadcast:simulation_updated");
      expect(JSON.parse(publisher.published[0]?.message ?? "")).toMatchObject({
        tenantId: "project-1",
        event: '{"event":"simulation_updated"}',
        timestamp: expect.any(Number),
      });
    });

    it("keeps the caller running when Redis refuses the publish", async () => {
      const channel = RedisScenarioEventBroadcastChannel.create({
        publish: () => Promise.reject(new Error("redis down")),
      });

      await expect(
        channel.broadcastToTenant({
          projectId: "project-1",
          message: "{}",
          eventType: "simulation_updated",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a project's delta allowance is spent", () => {
    it("drops deltas past the allowance without publishing them", async () => {
      const publisher = recordingPublisher();
      const channel = RedisScenarioEventBroadcastChannel.create(publisher);
      const outcomes: boolean[] = [];

      for (let sent = 0; sent < 600; sent += 1) {
        outcomes.push(
          await channel.broadcastToTenantRateLimited({
            projectId: "project-1",
            message: "{}",
            eventType: "simulation_updated",
            tier: "delta",
          }),
        );
      }

      expect(outcomes).toContain(false);
      expect(publisher.published).toHaveLength(outcomes.filter(Boolean).length);
    });
  });
});

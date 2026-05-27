import { describe, expect, it, vi } from "vitest";
import { QueueRedisRepository } from "../repositories/queue.redis.repository";
import { GroupStagingScripts, GROUP_QUEUE_REGISTRY_KEY } from "~/server/event-sourcing/queues/groupQueue/scripts";

type ScanPage = [cursor: string, keys: string[]];

function createRedis(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    smembers: vi.fn().mockResolvedValue([]),
    sadd: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(["0", []] as ScanPage),
    ...overrides,
  };
}

describe("group queue discovery", () => {
  describe("when a producer starts", () => {
    /** @scenario A starting producer advertises its queue name in the registry */
    it("adds its queue name to the registry set", async () => {
      const redis = createRedis();
      const scripts = new GroupStagingScripts(redis as never, "{event-sourcing/jobs}");

      await scripts.registerQueue();

      expect(redis.sadd).toHaveBeenCalledWith(
        GROUP_QUEUE_REGISTRY_KEY,
        "{event-sourcing/jobs}",
      );
    });
  });

  describe("when the registry set has names", () => {
    /** @scenario Discovery reads the registry set instead of scanning the keyspace */
    it("returns registry members without scanning the keyspace", async () => {
      const redis = createRedis({
        smembers: vi.fn().mockResolvedValue(["{event-sourcing/jobs}"]),
      });
      const repo = new QueueRedisRepository(redis as never);

      const names = await repo.discoverQueueNames();

      expect(names).toEqual(["{event-sourcing/jobs}"]);
      expect(redis.smembers).toHaveBeenCalledWith(GROUP_QUEUE_REGISTRY_KEY);
      expect(redis.scan).not.toHaveBeenCalled();
    });
  });

  describe("when the registry set is empty but a ready set exists", () => {
    /** @scenario Discovery falls back to a one-time scan when the registry is empty */
    it("scans once and backfills the discovered names into the registry", async () => {
      const redis = createRedis({
        smembers: vi.fn().mockResolvedValue([]),
        scan: vi
          .fn()
          .mockResolvedValue([
            "0",
            ["{event-sourcing/jobs}:gq:ready"],
          ] satisfies ScanPage),
      });
      const repo = new QueueRedisRepository(redis as never);

      const names = await repo.discoverQueueNames();

      expect(names).toEqual(["{event-sourcing/jobs}"]);
      expect(redis.scan).toHaveBeenCalledTimes(1);
      expect(redis.sadd).toHaveBeenCalledWith(
        GROUP_QUEUE_REGISTRY_KEY,
        "{event-sourcing/jobs}",
      );
    });
  });

  describe("when no queues exist anywhere", () => {
    /** @scenario Discovery returns nothing without backfilling when no queues exist */
    it("returns an empty list and writes nothing to the registry", async () => {
      const redis = createRedis();
      const repo = new QueueRedisRepository(redis as never);

      const names = await repo.discoverQueueNames();

      expect(names).toEqual([]);
      expect(redis.sadd).not.toHaveBeenCalled();
    });
  });
});

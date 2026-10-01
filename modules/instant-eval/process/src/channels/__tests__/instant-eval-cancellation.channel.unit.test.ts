/**
 * The cancellation hint, and the two directions it fails soft in.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import { MemoryInstantEvalCancellationChannel } from "../memory/memory.instant-eval-cancellation.channel.ts";
import {
  instantEvalCancelKey,
  type InstantEvalCancellationRedis,
  RedisInstantEvalCancellationChannel,
} from "../redis/redis.instant-eval-cancellation.channel.ts";

/** A Redis that records what it was told, and can be made to fail. */
function recordingRedis(failing = false) {
  const keys = new Map<string, { value: string; ttlSeconds: number }>();

  const redis: InstantEvalCancellationRedis = {
    set: (key, value, _mode, seconds) => {
      if (failing) return Promise.reject(new Error("redis is unreachable"));
      keys.set(key, { value, ttlSeconds: seconds });

      return Promise.resolve("OK");
    },
    exists: (key) => {
      if (failing) return Promise.reject(new Error("redis is unreachable"));

      return Promise.resolve(keys.has(key) ? 1 : 0);
    },
  };

  return { redis, keys };
}

describe("given a run someone asked to stop", () => {
  describe("when the hint is written", () => {
    it("writes one key for the run, expiring past the longest run", async () => {
      const { redis, keys } = recordingRedis();

      await RedisInstantEvalCancellationChannel.create(redis).request({ runId: "run-1" });

      expect(keys.get(instantEvalCancelKey("run-1"))).toEqual({ value: "1", ttlSeconds: 3600 });
    });

    it("is read back as requested by the page about to start", async () => {
      const { redis } = recordingRedis();
      const channel = RedisInstantEvalCancellationChannel.create(redis);

      await channel.request({ runId: "run-1" });

      expect(await channel.isRequested({ runId: "run-1" })).toBe(true);
      expect(await channel.isRequested({ runId: "run-2" })).toBe(false);
    });
  });

  describe("when Redis cannot be reached", () => {
    it("still returns from the write, because the event behind it is the record", async () => {
      const { redis } = recordingRedis(true);

      await expect(
        RedisInstantEvalCancellationChannel.create(redis).request({ runId: "run-1" }),
      ).resolves.toBeUndefined();
    });

    it("answers not cancelled, so the run judges one more page rather than stopping", async () => {
      const { redis } = recordingRedis(true);

      expect(
        await RedisInstantEvalCancellationChannel.create(redis).isRequested({ runId: "run-1" }),
      ).toBe(false);
    });
  });
});

describe("given a deployment with no Redis", () => {
  it("keeps the hint in this process, which is where the suite reads it", async () => {
    const channel = MemoryInstantEvalCancellationChannel.create();

    expect(await channel.isRequested({ runId: "run-1" })).toBe(false);

    await channel.request({ runId: "run-1" });

    expect(await channel.isRequested({ runId: "run-1" })).toBe(true);
  });
});

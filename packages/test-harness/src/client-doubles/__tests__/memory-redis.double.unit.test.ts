import { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { memoryRedisDouble, memoryRedisStore } from "../redis.double.ts";

describe("given a memory Redis double", () => {
  describe("when the code writes and reads keys", () => {
    /** @scenario "A memory Redis answers commands from its own store" */
    it("answers strings, sets, sorted sets and hashes from the store", async () => {
      const store = memoryRedisStore();
      const redis = memoryRedisDouble({ store });

      await expect(redis.set("lock", "a", "PX", 500, "NX")).resolves.toBe("OK");
      await expect(redis.set("lock", "b", "NX")).resolves.toBeNull();
      await expect(redis.incr("counter")).resolves.toBe(1);
      await redis.sadd("members", "x", "y");
      await redis.zadd("ready", 3, "late", 1, "early");
      await redis.zadd("ready", "XX", "LT", 5, "early");
      await redis.hset("hash", { field: "value" });

      await expect(redis.get("lock")).resolves.toBe("a");
      expect(store.expiries.get("lock")).toBe(500);
      await expect(redis.smembers("members")).resolves.toEqual(["x", "y"]);
      await expect(redis.zrange("ready", 0, -1, "WITHSCORES")).resolves.toEqual([
        "early",
        "1",
        "late",
        "3",
      ]);
      await expect(redis.zrevrange("ready", 0, 0)).resolves.toEqual(["late"]);
      await expect(redis.zrangebyscore("ready", "(1", "+inf")).resolves.toEqual(["late"]);
      await expect(redis.hgetall("hash")).resolves.toEqual({ field: "value" });
      await expect(redis.scan("0", "MATCH", "rea*", "COUNT", 10)).resolves.toEqual([
        "0",
        ["ready"],
      ]);
    });

    it("drops a collection when its last member goes", async () => {
      const redis = memoryRedisDouble();
      await redis.zadd("jobs", 1, "job-1");
      await redis.zrem("jobs", "job-1");

      await expect(redis.ttl("jobs")).resolves.toBe(-2);
    });
  });

  describe("when the code batches commands", () => {
    it("runs a pipeline in order, answering a failed command as its error", async () => {
      const redis = memoryRedisDouble({
        script: {
          zcard: async () => {
            throw new Error("ZCARD failed");
          },
        },
      });

      const results = await redis.pipeline().incr("counter").zcard("jobs").get("counter").exec();

      expect(results).toEqual([
        [null, 1],
        [new Error("ZCARD failed"), null],
        [null, "1"],
      ]);
    });
  });

  describe("when connections duplicated from it publish and subscribe", () => {
    it("delivers a message to every subscribed connection over the shared store", async () => {
      const publisher = memoryRedisDouble();
      const subscriber = publisher.duplicate();
      const onMessage = vi.fn();
      subscriber.on("message", onMessage);
      await subscriber.subscribe("events");

      await expect(publisher.publish("events", "hello")).resolves.toBe(1);
      expect(onMessage).toHaveBeenCalledWith("events", "hello");
    });
  });

  describe("when the script overrides or adds a command", () => {
    it("answers the scripted command, and duplicates keep it", async () => {
      const evaluate = vi.fn().mockResolvedValue(1);
      const redis = memoryRedisDouble({ script: { eval: evaluate } });

      await expect(redis.duplicate().eval("return 1", 0)).resolves.toBe(1);
      expect(evaluate).toHaveBeenCalledWith("return 1", 0);
    });
  });

  describe("when the code runs a command the store does not implement", () => {
    /** @scenario "An unscripted method throws naming its path" */
    it("throws naming the command, in a pipeline too", () => {
      const redis = memoryRedisDouble();

      expect(() => redis.lpush("list", "a")).toThrow("redis.lpush is not scripted");
      expect(() => redis.pipeline().lpush("list", "a")).toThrow(
        "redis.pipeline.lpush is not scripted",
      );
    });
  });

  describe("when it is handed to code that wants a connection", () => {
    /** @scenario "A client double typechecks as the real client" */
    it("is an ioredis Redis without a cast", () => {
      const redis: Redis = memoryRedisDouble();

      expect(redis).toBeInstanceOf(Redis);
    });
  });
});

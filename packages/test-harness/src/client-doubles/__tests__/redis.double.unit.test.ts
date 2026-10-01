import { type Cluster, Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { redisDouble } from "../redis.double.ts";

describe("given a Redis double", () => {
  describe("when the code runs a scripted command", () => {
    /** @scenario "A scripted member answers what the test scripted" */
    it("answers the scripted reply, including a connection it duplicates", async () => {
      const scan = vi.fn().mockResolvedValueOnce(["0", ["key-1"]]);
      const subscriber = redisDouble({ subscribe: async () => 1 });
      const redis = redisDouble({ scan, duplicate: () => subscriber });

      await expect(redis.scan("0", "MATCH", "key-*")).resolves.toEqual(["0", ["key-1"]]);
      expect(scan).toHaveBeenCalledWith("0", "MATCH", "key-*");
      expect(redis.duplicate()).toBe(subscriber);
    });
  });

  describe("when the code runs a command nobody scripted", () => {
    /** @scenario "An unscripted method throws naming its path" */
    it("throws naming the command", () => {
      const redis = redisDouble({ scan: async () => ["0", []] });

      expect(() => redis.get("key-1")).toThrow("redis.get is not scripted");
    });
  });

  describe("when the code reads connection state nobody scripted", () => {
    /** @scenario "An unscripted property read throws naming its path" */
    it("throws naming the property, and answers a scripted one", () => {
      expect(() => redisDouble().status).toThrow("redis.status is not scripted");
      expect(redisDouble({ status: "ready" }).status).toBe("ready");
    });
  });

  describe("when it is handed to code that wants a connection", () => {
    /** @scenario "A client double typechecks as the real client" */
    it("is an ioredis Redis, and so a Redis | Cluster connection, without a cast", () => {
      const redis: Redis = redisDouble();
      const connection: Redis | Cluster = redis;

      expect(connection).toBeInstanceOf(Redis);
    });
  });
});

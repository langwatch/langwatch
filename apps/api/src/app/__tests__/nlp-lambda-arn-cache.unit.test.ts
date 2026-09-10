import { describe, expect, it, vi } from "vitest";
import {
  RedisNlpLambdaArnCache,
  type NlpLambdaArnRedisConnection,
} from "../nlp-lambda-arn-cache.ts";

/** A recording double over the cache's own minimal Redis surface. */
function recordingRedis() {
  const store = new Map<string, string>();
  const calls: { get: string[]; setex: Array<[string, number, string]>; del: string[] } = {
    get: [],
    setex: [],
    del: [],
  };
  const redis: NlpLambdaArnRedisConnection = {
    get: vi.fn(async (key: string) => {
      calls.get.push(key);
      return store.get(key) ?? null;
    }),
    setex: vi.fn(async (key: string, ttlSeconds: number, value: string) => {
      calls.setex.push([key, ttlSeconds, value]);
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      calls.del.push(key);
      store.delete(key);
      return 1;
    }),
  };
  return { redis, calls, store };
}

describe("RedisNlpLambdaArnCache", () => {
  describe("given a project's resolved ARN was cached", () => {
    describe("when another pod asks for the same project", () => {
      /** @scenario "A resolved function is shared across every pod through Redis" */
      it("reads the value the first pod's resolution wrote, off the shared connection", async () => {
        const { redis } = recordingRedis();
        const cache = RedisNlpLambdaArnCache.create(redis);

        await cache.set({
          key: "project-1",
          value: "arn:aws:lambda:us-east-1:1:function:project-1",
          ttlSeconds: 3600,
        });

        await expect(cache.tryGet("project-1")).resolves.toBe(
          "arn:aws:lambda:us-east-1:1:function:project-1",
        );
      });
    });
  });

  describe("given no project has been resolved yet", () => {
    describe("when a pod asks for its ARN", () => {
      it("answers null rather than throwing", async () => {
        const { redis } = recordingRedis();
        const cache = RedisNlpLambdaArnCache.create(redis);

        await expect(cache.tryGet("project-unresolved")).resolves.toBeNull();
      });
    });
  });

  describe("given the cache's own key prefix", () => {
    describe("when it writes, reads and deletes a project's entry", () => {
      it("prefixes every key it touches on the shared connection", async () => {
        const { redis, calls } = recordingRedis();
        const cache = RedisNlpLambdaArnCache.create(redis);

        await cache.set({ key: "project-2", value: "arn:aws:lambda:x", ttlSeconds: 60 });
        await cache.tryGet("project-2");
        await cache.delete("project-2");

        expect(calls.setex[0]?.[0]).toBe("nlp_lambda_arn:v1:project-2");
        expect(calls.setex[0]?.[1]).toBe(60);
        expect(calls.get[0]).toBe("nlp_lambda_arn:v1:project-2");
        expect(calls.del[0]).toBe("nlp_lambda_arn:v1:project-2");
      });
    });
  });

  describe("given a cached entry was deleted", () => {
    describe("when a pod asks for it again", () => {
      it("reads null after the delete, off the same shared connection", async () => {
        const { redis } = recordingRedis();
        const cache = RedisNlpLambdaArnCache.create(redis);

        await cache.set({ key: "project-3", value: "arn:aws:lambda:y", ttlSeconds: 60 });
        await cache.delete("project-3");

        await expect(cache.tryGet("project-3")).resolves.toBeNull();
      });
    });
  });
});

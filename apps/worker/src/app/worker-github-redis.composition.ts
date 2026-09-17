import type { RedisConnection } from "@langwatch/redis-client";
import { z } from "zod";

/** Minimal Redis surface owned by GitHub's private adapter. */
export type WorkerGithubRedisConnection = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  del(key: string): Promise<number>;
  getdel?: (key: string) => Promise<string | null>;
  eval?: (script: string, numKeys: number, ...args: string[]) => Promise<number | string | null>;
};

const nullableString = z.string().nullable();
const scriptResult = z.union([z.number(), z.string(), z.null()]);

/** Adapts Redis command overloads to GitHub's portable command boundary. */
export function createWorkerGithubRedis(redis: RedisConnection): WorkerGithubRedisConnection {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ...args) =>
      nullableString.parse(await redis.call("SET", key, value, ...args)),
    del: (key) => redis.del(key),
    getdel: async (key) => nullableString.parse(await redis.call("GETDEL", key)),
    eval: async (script, numKeys, ...args) =>
      scriptResult.parse(await redis.eval(script, numKeys, ...args)),
  };
}

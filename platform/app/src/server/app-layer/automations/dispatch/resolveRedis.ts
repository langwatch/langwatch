import type { RedisConnection } from "@langwatch/redis-client";
import { tryGetApp } from "~/server/app-layer/app";

/**
 * Resolves the connection a dispatch cap should use.
 *
 * Omitting `redis` takes the App's; passing `null` explicitly forces the
 * in-memory path. A default parameter can't tell "not passed" from "passed
 * undefined", so the sentinel is how a caller opts out (ADR-090).
 *
 * Shared rather than repeated: the three-way meaning of `undefined` / `null` /
 * a connection is the whole contract, and two copies of it drift into two
 * different contracts the first time one is edited.
 */
export function resolveRedis(
  redis: RedisConnection | null | undefined,
): RedisConnection | null {
  return redis === void 0 ? (tryGetApp()?.redis ?? null) : redis;
}

/**
 * Shared helpers for Redis queue name handling.
 *
 * All BullMQ queue names in this project are wrapped in Redis Cluster hash
 * tags (e.g. `{pipeline/handler/spanStorage}`). The braces ensure all keys
 * for a queue land on the same Redis Cluster slot. See makeQueueName() in
 * the main app for the wrapping side.
 */

import type IORedis from "ioredis";

/**
 * Strip Redis Cluster hash tags from a queue name for display.
 *
 *   "{pipeline/handler/foo}" → "pipeline/handler/foo"
 *   "plain"                  → "plain"
 */
export function stripHashTag(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    return name.slice(1, -1);
  }
  return name;
}

/**
 * A queue name is considered a group queue if it is hash-tagged ({...})
 * and the inner name contains a `/` (the pipeline/handler/projection pattern).
 */
export function isGroupQueue(name: string): boolean {
  if (!name.startsWith("{") || !name.endsWith("}")) return false;
  return name.slice(1, -1).includes("/");
}

/**
 * Discover all unique BullMQ queue names from Redis keys.
 * Returns the raw names including hash tags (e.g. `{scenarios}`).
 */
export async function discoverQueueNames(
  redis: IORedis,
): Promise<string[]> {
  const allBullKeys = await redis.keys("bull:*");

  const names = new Set<string>();
  for (const key of allBullKeys) {
    const name = key.split(":")[1];
    if (name) names.add(name);
  }

  return Array.from(names);
}

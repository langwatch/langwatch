import type IORedis from "ioredis";

export function stripHashTag(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    return name.slice(1, -1);
  }
  return name;
}

export async function discoverQueueNames(redis: IORedis): Promise<string[]> {
  // Use SCAN instead of KEYS to avoid blocking Redis with O(N) command.
  // COUNT 50000 reduces roundtrips on large keyspaces (826K+ keys → ~17 iterations vs ~1650 with COUNT 500).
  const names = new Set<string>();

  // Discover group queues via their ready sorted set ({queueName}:gq:ready)
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "*:gq:ready", "COUNT", 50000);
    cursor = nextCursor;
    for (const key of keys) {
      const gqIdx = key.indexOf(":gq:ready");
      if (gqIdx > 0) {
        names.add(key.slice(0, gqIdx));
      }
    }
  } while (cursor !== "0");

  return Array.from(names);
}

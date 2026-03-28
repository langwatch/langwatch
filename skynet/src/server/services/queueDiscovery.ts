import type IORedis from "ioredis";

export function stripHashTag(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    return name.slice(1, -1);
  }
  return name;
}

export function isGroupQueue(name: string): boolean {
  if (!name.startsWith("{") || !name.endsWith("}")) return false;
  return name.slice(1, -1).includes("/");
}

export async function discoverQueueNames(redis: IORedis): Promise<string[]> {
  // Use SCAN instead of KEYS to avoid blocking Redis with O(N) command.
  // COUNT 50000 reduces roundtrips on large keyspaces (826K+ keys → ~17 iterations vs ~1650 with COUNT 500).
  const names = new Set<string>();

  // Discover queues via meta keys (bull:{queueName}:meta — one per queue, avoids matching all job keys)
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "bull:*:meta", "COUNT", 50000);
    cursor = nextCursor;
    for (const key of keys) {
      const name = key.split(":")[1];
      if (name) names.add(name);
    }
  } while (cursor !== "0");

  // Discover group queues ({queueName}:gq:...)
  cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "*:gq:ready", "COUNT", 50000);
    cursor = nextCursor;
    for (const key of keys) {
      // Key format: {pipeline/handler/name}:gq:ready → extract everything before :gq:ready
      const gqIdx = key.indexOf(":gq:ready");
      if (gqIdx > 0) {
        const name = key.slice(0, gqIdx);
        names.add(name);
      }
    }
  } while (cursor !== "0");

  return Array.from(names);
}

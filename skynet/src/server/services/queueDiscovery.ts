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
  // Use SCAN instead of KEYS to avoid blocking Redis with O(N) command
  const names = new Set<string>();
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "bull:*", "COUNT", 500);
    cursor = nextCursor;
    for (const key of keys) {
      const name = key.split(":")[1];
      if (name) names.add(name);
    }
  } while (cursor !== "0");
  return Array.from(names);
}

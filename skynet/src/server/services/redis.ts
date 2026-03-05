import IORedis from "ioredis";

let redis: IORedis | null = null;

export function getRedis(): IORedis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL environment variable is required");
    }
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  }
  return redis;
}

export interface RedisInfo {
  usedMemoryHuman: string;
  peakMemoryHuman: string;
  usedMemoryBytes: number;
  peakMemoryBytes: number;
  maxMemoryBytes: number;
  connectedClients: number;
}

export async function getRedisInfo(r: IORedis): Promise<RedisInfo> {
  const info = await r.info();
  const get = (key: string): string => {
    const match = info.match(new RegExp(`${key}:(.+)`));
    return match?.[1]?.trim() ?? "?";
  };
  return {
    usedMemoryHuman: get("used_memory_human"),
    peakMemoryHuman: get("used_memory_peak_human"),
    usedMemoryBytes: parseInt(get("used_memory"), 10) || 0,
    peakMemoryBytes: parseInt(get("used_memory_peak"), 10) || 0,
    maxMemoryBytes: parseInt(get("maxmemory"), 10) || 0,
    connectedClients: parseInt(get("connected_clients"), 10) || 0,
  };
}

import { MemoryTraceTenantBroadcastChannel } from "./memory/memory.trace-tenant-broadcast.channel.ts";
import { RedisTraceTenantBroadcastChannel } from "./redis/redis.trace-tenant-broadcast.channel.ts";

/** The two tiers behind `TraceTenantBroadcast`. */
export const traceTenantBroadcastChannels = {
  live: RedisTraceTenantBroadcastChannel,
  memory: MemoryTraceTenantBroadcastChannel,
};

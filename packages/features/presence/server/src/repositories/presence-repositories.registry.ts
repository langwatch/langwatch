import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryPresenceRepositories } from "./memory/memory.presence.repositories.ts";
import { RedisPresenceRepositories } from "./redis/redis.presence.repositories.ts";

/**
 * Presence sessions live for a TTL, not forever, so the durable backend is the
 * process's Redis rather than its database. A process with no Redis selects
 * `memory` and serves the sessions its own instance can see.
 */
export const presenceRepositories = defineRepositories({
  redis: RedisPresenceRepositories,
  memory: MemoryPresenceRepositories,
});

import { defineRepositories } from "@langwatch/kernel";

import { MemoryRumRepositories } from "./memory/memory.rum.repositories.ts";
import { RedisRumRepositories } from "./redis/redis.rum.repositories.ts";

/** The buckets live for a minute, so the durable backend is the process's Redis. */
export const rumRepositories = defineRepositories({
  live: RedisRumRepositories,
  memory: MemoryRumRepositories,
});

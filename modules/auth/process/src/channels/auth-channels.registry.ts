import { defineChannels } from "@langwatch/process";

import { MemoryAuthChannels } from "./memory/memory.auth.channels.ts";
import { RedisAuthChannels } from "./redis/redis.auth.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const authChannels = defineChannels({
  live: RedisAuthChannels,
  memory: MemoryAuthChannels,
});

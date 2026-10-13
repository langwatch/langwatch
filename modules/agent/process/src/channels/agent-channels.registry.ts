import { defineChannels } from "@langwatch/process";

import { MemoryAgentChannels } from "./memory/memory.agent.channels.ts";
import { RedisAgentChannels } from "./redis/redis.agent.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const agentChannels = defineChannels({
  live: RedisAgentChannels,
  memory: MemoryAgentChannels,
});

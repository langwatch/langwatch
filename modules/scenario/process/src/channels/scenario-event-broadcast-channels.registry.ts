import { MemoryScenarioEventBroadcastChannel } from "./memory/memory.scenario-event-broadcast.channel.ts";
import { RedisScenarioEventBroadcastChannel } from "./redis/redis.scenario-event-broadcast.channel.ts";

/** The two tiers behind `ScenarioEventBroadcast`. */
export const scenarioEventBroadcastChannels = {
  live: RedisScenarioEventBroadcastChannel,
  memory: MemoryScenarioEventBroadcastChannel,
};

import { MemoryExperimentRunEventStreamChannel } from "./memory/memory.experiment-run-event-stream.channel.ts";
import { RedisExperimentRunEventStreamChannel } from "./redis/redis.experiment-run-event-stream.channel.ts";

/** The two tiers behind `ExperimentRunEventStream`. */
export const experimentRunEventStreamChannels = {
  live: RedisExperimentRunEventStreamChannel,
  memory: MemoryExperimentRunEventStreamChannel,
};

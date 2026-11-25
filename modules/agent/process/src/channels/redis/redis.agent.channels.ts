import type { RedisConnection } from "@langwatch/redis-client";

import type { AgentChannels } from "../agent.channels.ts";
import { RedisConnectedAgentRelayChannel } from "./redis.connected-agent-relay.channel.ts";

/** The relay's messages over Redis pub/sub, across every app replica. */
export class RedisAgentChannels {
  static readonly requires = ["redis"] as const;

  static create({ redis }: { redis: RedisConnection }): AgentChannels {
    return { relay: RedisConnectedAgentRelayChannel.create(redis) };
  }
}

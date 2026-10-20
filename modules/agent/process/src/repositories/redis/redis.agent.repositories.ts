import type { RedisConnection } from "@langwatch/redis-client";
import { SessionStateStoreFactory } from "@langwatch/redis-client";

import type { AgentRepositories } from "../agent.repositories.ts";
import { RedisConnectedAgentStateRepository } from "./redis.connected-agent-state.repository.ts";

/** The rows agent keeps in the process's Redis: the connected-agent relay state. */
export class RedisAgentRepositories {
  static readonly requires = ["redis"] as const;

  static create({
    redis,
  }: Readonly<{ redis: RedisConnection }>): Pick<AgentRepositories, "connectedAgentState"> {
    return {
      connectedAgentState: RedisConnectedAgentStateRepository.create(
        SessionStateStoreFactory.redis(redis),
      ),
    };
  }
}

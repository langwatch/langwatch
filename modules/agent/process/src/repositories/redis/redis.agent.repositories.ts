import type { RedisConnection } from "@langwatch/redis-client";
import { SessionStateStoreFactory } from "@langwatch/redis-client";

import type { AgentRepositories } from "../agent.repositories.ts";

/** The rows agent keeps in the process's Redis: the connected-agent session state. */
export class RedisAgentRepositories {
  static readonly requires = ["redis"] as const;

  static create({
    redis,
  }: Readonly<{ redis: RedisConnection }>): Pick<AgentRepositories, "sessionState"> {
    return { sessionState: SessionStateStoreFactory.redis(redis) };
  }
}

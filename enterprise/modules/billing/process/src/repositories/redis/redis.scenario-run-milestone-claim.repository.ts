import type { Cluster, Redis } from "ioredis";

import { ScenarioRunMilestoneClaimRepository } from "../scenario-run-milestone-claim.repository.ts";

export const SCENARIO_RUN_MILESTONE_CLAIM_PREFIX = "billing:scenario-run-milestone:";
/** Outlives any redelivery of the event; a claim only has to span the queue's retry window. */
export const SCENARIO_RUN_MILESTONE_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ScenarioRunMilestoneClaimRedis = Pick<Redis | Cluster, "set">;

export class RedisScenarioRunMilestoneClaimRepository extends ScenarioRunMilestoneClaimRepository {
  private constructor(private readonly redis: ScenarioRunMilestoneClaimRedis) {
    super();
  }

  static create(options: {
    redis: ScenarioRunMilestoneClaimRedis;
  }): RedisScenarioRunMilestoneClaimRepository {
    return new RedisScenarioRunMilestoneClaimRepository(options.redis);
  }

  async claim({ eventId }: { eventId: string }): Promise<boolean> {
    const stored = await this.redis.set(
      `${SCENARIO_RUN_MILESTONE_CLAIM_PREFIX}${eventId}`,
      "1",
      "PX",
      SCENARIO_RUN_MILESTONE_CLAIM_TTL_MS,
      "NX",
    );
    return stored === "OK";
  }
}

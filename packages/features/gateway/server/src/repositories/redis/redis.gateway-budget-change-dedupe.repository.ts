import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { GatewayBudgetChangeDedupeRepository } from "../gateway-budget-change-dedupe.repository";

const BUDGET_CHANGE_EVENT_KEY_PREFIX = "gateway_budget_change:";

/**
 * Redis SET NX with a TTL, mirroring the span/share-view dedupe repositories.
 * Fixed from the first claim, not sliding, so a busy project can't push its
 * own refresh back with its own traffic.
 */
export class RedisGatewayBudgetChangeDedupeRepository extends GatewayBudgetChangeDedupeRepository {
  static create(redis: IORedis | Cluster): RedisGatewayBudgetChangeDedupeRepository {
    return new RedisGatewayBudgetChangeDedupeRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async claimWindow({
    projectId,
    windowSeconds,
  }: {
    projectId: string;
    windowSeconds: number;
  }): Promise<boolean> {
    const key = `${BUDGET_CHANGE_EVENT_KEY_PREFIX}${projectId}`;
    const result = await this.redis.set(key, "1", "EX", windowSeconds, "NX");

    return result === "OK";
  }
}

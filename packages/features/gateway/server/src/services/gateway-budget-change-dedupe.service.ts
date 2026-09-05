import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

const logger = createLogger("langwatch:gateway:budget-change-event-dedupe");

const BUDGET_CHANGE_EVENT_KEY_PREFIX = "gateway_budget_change:";

/**
 * How long one advisory BUDGET_UPDATED emission stands in for the ones that follow. Matched to the /changes long-poll hold (timeout_s, default 10s) so continuous traffic causes at most one project-wide eviction per poll cycle. Fixed window from the first emission, not sliding, so a busy project refreshes on a fixed cadence rather than having refresh pushed back by its own traffic.
 */
export const BUDGET_CHANGE_EVENT_WINDOW_SECONDS = 10;

export interface BudgetChangeEventDedupeService {
  /**
   * Whether this debit should emit BUDGET_UPDATED. Keyed on the project alone, matching the consumer's invalidation granularity: the gateway's change-feed subscriber evicts every bundle matching ProjectID and ignores budget_id for this kind (services/aigateway/adapters/authresolver/service.go, ChangeKindBudgetUpdated) — a second event for a different budget in the same project would evict what the first already evicted, and the re-materialise reads current spend for every budget anyway.
   */
  shouldEmit(params: { projectId: string }): Promise<boolean>;
}

/** No Redis (tests, SKIP_REDIS, dev without Redis): emit every time. */
class NullBudgetChangeEventDedupeService implements BudgetChangeEventDedupeService {
  async shouldEmit(): Promise<boolean> {
    return true;
  }
}

/**
 * Redis SET NX with a TTL, mirroring the span/share-view dedupe services. The change event is an invalidation signal, not a data carrier — spend itself is read from ClickHouse on re-materialise, so emissions inside one window are redundant with each other. Gates only *advisory* emissions: suppressing one that carries a budget into breach would leave an over-limit key served from a cached bundle, a different cost the caller owns separately.
 */
export class RedisBudgetChangeEventDedupeService implements BudgetChangeEventDedupeService {
  /**
   * A deployment with no Redis gets the always-emit stand-in, which is what
   * this path did before the dedupe existed.
   */
  static create(redis: IORedis | Cluster | null): BudgetChangeEventDedupeService {
    return redis
      ? new RedisBudgetChangeEventDedupeService(redis)
      : new NullBudgetChangeEventDedupeService();
  }

  private constructor(private readonly redis: IORedis | Cluster) {}

  async shouldEmit({ projectId }: { projectId: string }): Promise<boolean> {
    const key = `${BUDGET_CHANGE_EVENT_KEY_PREFIX}${projectId}`;
    try {
      const result = await this.redis.set(key, "1", "EX", BUDGET_CHANGE_EVENT_WINDOW_SECONDS, "NX");

      return result === "OK";
    } catch (error) {
      // Fail toward emitting. Emitting is what this path did before the
      // dedupe existed and is always correct, only noisier; suppressing is
      // the optimization. A Redis outage must not be a way to hold back a
      // cache invalidation the gateway is waiting on.
      logger.warn(
        { projectId, error },
        "budget change-event dedupe unavailable; emitting this change event",
      );

      return true;
    }
  }
}

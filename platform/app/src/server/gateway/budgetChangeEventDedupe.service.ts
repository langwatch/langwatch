import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

const logger = createLogger("langwatch:gateway:budget-change-event-dedupe");

const BUDGET_CHANGE_EVENT_KEY_PREFIX = "gateway_budget_change:";

/**
 * How long one advisory BUDGET_UPDATED emission stands in for the ones that
 * follow it.
 *
 * Matched to the `/changes` long-poll hold (`timeout_s`, default 10s) so a
 * project under continuous traffic causes at most one project-wide eviction
 * per poll cycle rather than one per gateway request.
 *
 * A fixed window from the first emission, not a sliding one: the key is set
 * once and left to expire, so a busy project still refreshes on a fixed
 * cadence instead of having its refresh pushed back by its own traffic.
 */
export const BUDGET_CHANGE_EVENT_WINDOW_SECONDS = 10;

export interface BudgetChangeEventDedupeService {
  /**
   * Whether this debit should emit a BUDGET_UPDATED change event.
   *
   * Keyed on the project alone, because that is the granularity the consumer
   * invalidates at: the gateway's change-feed subscriber evicts every bundle
   * whose `ProjectID` matches and ignores `budget_id` entirely for this kind
   * (services/aigateway/adapters/authresolver/service.go, the
   * ChangeKindBudgetUpdated case). A second event for a different budget in
   * the same project would therefore evict exactly what the first already
   * evicted, and the re-materialise that follows reads current spend for
   * every budget, not just the one named.
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
 * Redis `SET NX` with a TTL, mirroring the span- and share-view dedupe
 * services.
 *
 * The change event is an invalidation signal, not a data carrier: it tells the
 * gateway to drop its cached bundles, and the spend figure itself is read from
 * ClickHouse when the bundle is re-materialised. Emissions inside one window
 * are therefore redundant with each other, because the eviction they ask for
 * has already been asked for and the read it triggers already sees every debit
 * written since.
 *
 * This service must only gate *advisory* emissions. Suppressing an emission
 * that carries a budget into breach would leave an over-limit key served from
 * a cached bundle, which is a different kind of cost entirely; the caller owns
 * that distinction.
 */
export class RedisBudgetChangeEventDedupeService implements BudgetChangeEventDedupeService {
  constructor(private readonly redis: IORedis | Cluster) {}

  async shouldEmit({ projectId }: { projectId: string }): Promise<boolean> {
    const key = `${BUDGET_CHANGE_EVENT_KEY_PREFIX}${projectId}`;
    try {
      const result = await this.redis.set(
        key,
        "1",
        "EX",
        BUDGET_CHANGE_EVENT_WINDOW_SECONDS,
        "NX",
      );
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

export function createBudgetChangeEventDedupeService(
  redis: IORedis | Cluster | null,
): BudgetChangeEventDedupeService {
  if (!redis) return new NullBudgetChangeEventDedupeService();
  return new RedisBudgetChangeEventDedupeService(redis);
}

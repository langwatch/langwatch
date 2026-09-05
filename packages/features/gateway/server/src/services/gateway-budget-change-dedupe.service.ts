import { createLogger } from "@langwatch/observability";
import type { GatewayBudgetChangeDedupeRepository } from "../repositories/gateway-budget-change-dedupe.repository";

const logger = createLogger("langwatch:gateway:budget-change-event-dedupe");

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

/** No dedupe store (tests, SKIP_REDIS, dev without Redis): emit every time. */
class NullBudgetChangeEventDedupeService implements BudgetChangeEventDedupeService {
  async shouldEmit(): Promise<boolean> {
    return true;
  }
}

/**
 * Gates only *advisory* emissions: the change event is an invalidation signal, not a data carrier — spend itself is read from ClickHouse on re-materialise, so emissions inside one window are redundant with each other. Suppressing one that carries a budget into breach would leave an over-limit key served from a cached bundle, a different cost the caller owns separately.
 */
export class GatewayBudgetChangeDedupeService implements BudgetChangeEventDedupeService {
  /**
   * A deployment with no dedupe store gets the always-emit stand-in, which is
   * what this path did before the dedupe existed.
   */
  static create(
    repository: GatewayBudgetChangeDedupeRepository | null,
  ): BudgetChangeEventDedupeService {
    return repository
      ? new GatewayBudgetChangeDedupeService(repository)
      : new NullBudgetChangeEventDedupeService();
  }

  private constructor(private readonly repository: GatewayBudgetChangeDedupeRepository) {}

  async shouldEmit({ projectId }: { projectId: string }): Promise<boolean> {
    try {
      return await this.repository.claimWindow({
        projectId,
        windowSeconds: BUDGET_CHANGE_EVENT_WINDOW_SECONDS,
      });
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

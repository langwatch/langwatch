import { createLogger } from "@langwatch/observability";
import type { GatewayBudgetChangeDedupeRepository } from "../repositories/gateway-budget-change-dedupe.repository.ts";

const logger = createLogger("langwatch:gateway:budget-change-event-dedupe");

/**
 * How long one advisory BUDGET_UPDATED emission stands in for the ones that follow. Matched to the
 * changes long-poll hold, so continuous traffic causes at most one project-wide eviction per poll
 * cycle. The window is fixed from the first emission rather than sliding.
 */
export const BUDGET_CHANGE_EVENT_WINDOW_SECONDS = 10;

export interface BudgetChangeEventDedupeService {
  /**
   * Whether this debit should emit BUDGET_UPDATED. Keyed on the project alone, matching the
   * consumer's invalidation granularity: the gateway's subscriber evicts every bundle for the
   * project and ignores the budget id, and re-materialising reads current spend for all of them.
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
 * Gates advisory emissions only: the change event is an invalidation signal, not a data carrier,
 * since spend itself is read from ClickHouse on re-materialise. Suppressing one that carries a
 * budget into breach would leave an over-limit key on a cached bundle, a cost the caller owns.
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

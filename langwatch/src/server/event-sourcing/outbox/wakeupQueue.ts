import type { EventSourcedQueueDefinition } from "../queues/queue.types";

/**
 * Wakeup payload sent to the GroupQueue when a row is enqueued (or
 * scheduled for retry). Carries only the routing keys — the variable-
 * size dispatch payload stays in PG. See ADR-023.
 *
 * Constant size means the queue never bloats regardless of how many
 * matches a single trigger produces.
 */
export interface OutboxWakeup extends Record<string, unknown> {
  reactorName: string;
  groupKey: string;
  /**
   * Tenant for fair scheduling (`TenantRateTracker` reads this).
   * Typically identical to `groupKey`, but kept explicit so callers
   * can group by something other than tenant if needed.
   */
  tenantId: string;
  /**
   * Wall-clock score for global ordering — see ADR-023. Defaults to
   * the enqueue time but callers may override (e.g. retry scheduling
   * sets it to the nextAttemptAt timestamp).
   */
  scheduledAt: number;
}

/**
 * Process function for the wakeup queue. Receives a wakeup, then
 * drains as many rows as it can for (reactorName, groupKey) by
 * leasing from the outbox and calling the registered dispatcher.
 */
export type OutboxWakeupProcessor = (wakeup: OutboxWakeup) => Promise<void>;

export function defineOutboxWakeupQueue({
  name,
  process,
}: {
  name: string;
  process: OutboxWakeupProcessor;
}): EventSourcedQueueDefinition<OutboxWakeup> {
  return {
    name,
    process,
    groupKey: (payload) => `${payload.reactorName}:${payload.groupKey}`,
    score: (payload) => payload.scheduledAt,
    options: {
      // Drainer workload is IO-bound (PG lease + HTTP dispatch). The
      // per-group FIFO means an individual group never goes parallel
      // — we just want enough parallelism across groups to cover
      // dispatcher latency.
      concurrency: 10,
      globalConcurrency: 300,
    },
  };
}

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
  /**
   * The wakeup's GroupQueue routing key. MUST start with `${projectId}/`
   * because the outbox queue is free-standing — it bypasses
   * `queueManager`'s automatic `${tenantId}/` wrapping, so the
   * producer is responsible for the prefix so `tenantIdFromGroupId`
   * (see `src/server/observability/tenantRateTracker.ts`) can extract
   * the tenant for per-tenant fairness via `TenantRateTracker`.
   *
   * Convention for trigger reactors:
   *   `${projectId}/${reactorName}:${triggerId}`
   *
   * Wakeups for the same groupKey are serialised by the GroupQueue, so
   * only one drainer at a time runs the dispatch loop for a given
   * trigger. NOTE this is wakeup-level serialisation, not row-level
   * ordering: the drainer's `leaseNext` filters by `(projectId,
   * reactorName)` and orders by `nextAttemptAt`, so within a single
   * wakeup it may dispatch rows from sibling triggers if theirs is
   * the earlier nextAttemptAt. Per-trigger FIFO holds only at the
   * wakeup boundary, not across an entire (project, reactor) backlog.
   */
  groupKey: string;
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
    // groupKey IS already the full `${projectId}/${reactorName}:${triggerId}`
    // form (or equivalent) — see the field comment on OutboxWakeup. The
    // queue's per-group serialisation uses it as-is; `tenantIdFromGroupId`
    // parses the projectId out for fair scheduling.
    groupKey: (payload) => payload.groupKey,
    score: (payload) => payload.scheduledAt,
    options: {
      // Drainer workload is IO-bound (PG lease + HTTP dispatch). The
      // per-group serialisation means an individual group never goes
      // parallel — we just want enough parallelism across groups to
      // cover dispatcher latency.
      concurrency: 10,
      globalConcurrency: 300,
    },
  };
}

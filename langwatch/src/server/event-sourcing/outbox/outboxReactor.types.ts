import type { Event } from "../domain/types";
import type { ReactorContext, ReactorOptions } from "../reactors/reactor.types";

/**
 * A single dispatch decision returned by an outbox reactor. The
 * reactor evaluates an event + fold state and returns zero or more
 * requests; each maps 1:1 to a ReactorOutbox row (subject to
 * dedupKey collision).
 */
export interface OutboxEnqueueRequest {
  /**
   * Stable identity of the match. (reactorName, dedupKey) is the
   * claim primitive — collisions deduplicate. See ADR-022.
   *
   * Convention (mirrors `groupKey` shape with a `${projectId}/`
   * prefix so dedup/group identifiers stay self-describing for
   * operator scans; `:trace:` / `:graph:` discriminator namespaces
   * subject types):
   *   - Trace/evaluation triggers: `${projectId}/${triggerId}:trace:${traceId}`
   *   - Custom-graph alerts:       `${projectId}/${triggerId}:graph:${customGraphId}`
   */
  dedupKey: string;
  /**
   * GroupQueue routing key for the wakeup — see ADR-023. MUST begin
   * with `${projectId}/` because the outbox queue is free-standing
   * and bypasses `queueManager`'s automatic `${tenantId}/` wrapping;
   * the producer is responsible for the prefix so
   * `tenantIdFromGroupId` can extract the tenant for per-tenant
   * fairness via `TenantRateTracker`.
   *
   * Convention for trigger reactors:
   *   `${projectId}/${reactorName}:${triggerId}`
   *
   * Wakeups for the same groupKey are serialised by the GroupQueue,
   * so only one drainer at a time runs the dispatch loop for a given
   * trigger. NOTE this is wakeup-level serialisation, not row-level
   * ordering — see the longer note on `OutboxWakeup.groupKey`.
   */
  groupKey: string;
  /**
   * Variable-size dispatch payload. Stays in PG; never carried in
   * wakeup payloads.
   */
  payload: unknown;
  /**
   * Per-row override for the retry budget. Defaults to the
   * outbox-wide setting (8 attempts).
   */
  maxAttempts?: number;
}

/**
 * Definition of an outbox-backed reactor — a stake-sensitive
 * side-effect handler whose dispatch is durable, retried, and
 * operator-queryable.
 *
 * Use `.withOutbox(projection, name, definition)` instead of
 * `.withReactor(...)` when the side effect MUST not be silently
 * swallowed (customer emails, Slack messages, dataset writes). See
 * ADR-024 for the criteria.
 *
 * Unlike a `ReactorDefinition`, an outbox reactor does not perform
 * the side effect inline. It only decides — by returning enqueue
 * requests — what to dispatch later. The actual dispatch logic
 * lives in an `OutboxDispatcher` registered against the same
 * `reactorName` on the OutboxDrainer.
 */
export interface OutboxReactorDefinition<
  E extends Event = Event,
  FoldState = unknown,
> {
  name: string;
  /**
   * Decide which (if any) outbox rows to enqueue for this event.
   * Returns an empty array when nothing matches. Replay-safe — the
   * outbox dedupes on (name, dedupKey) so callers do not need to
   * track which matches they have already enqueued.
   */
  decide(
    event: E,
    context: ReactorContext<FoldState>,
  ): Promise<OutboxEnqueueRequest[]>;
  options?: ReactorOptions;
}

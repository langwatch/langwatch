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
   */
  dedupKey: string;
  /**
   * GroupQueue routing key for the wakeup. Typically projectId or
   * tenantId. See ADR-023.
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

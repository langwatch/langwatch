import type { Event } from "../domain/types";
import type { ReactorContext, ReactorOptions } from "../reactors/reactor.types";
import type { OutboxPayload } from "./outbox.types";

/**
 * A single dispatch decision returned by an outbox reactor. The
 * reactor evaluates an event + fold state and returns zero or more
 * requests; each maps 1:1 to a ReactorOutbox row (subject to
 * dedupKey collision).
 */
export interface OutboxEnqueueRequest {
  /**
   * Stable identity of the match. (reactorName, dedupKey) is the
   * claim primitive — collisions deduplicate. See ADR-025.
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
   * GroupQueue routing key for the wakeup — see ADR-026. MUST begin
   * with `${projectId}/` because the outbox queue is free-standing
   * and bypasses `queueManager`'s automatic `${tenantId}/` wrapping;
   * the producer is responsible for the prefix so
   * `tenantIdFromGroupId` can extract the tenant for per-tenant
   * fairness via `TenantRateTracker`.
   *
   * Convention for trigger reactors:
   *   `${projectId}/${reactorName}:${triggerId}`
   *
   * Per-trigger FIFO falls out of this shape.
   */
  groupKey: string;
  /**
   * Variable-size dispatch payload. Stays in PG; never carried in
   * wakeup payloads. Typed as `OutboxPayload` (Prisma JSON-compatible)
   * so non-serialisable values fail at compile time instead of when
   * the row is persisted.
   */
  payload: OutboxPayload;
  /**
   * Per-row override for the retry budget. Defaults to the
   * outbox-wide setting (8 attempts).
   */
  maxAttempts?: number;
  /**
   * Per-request enqueue options forwarded to the underlying outbox
   * runtime. Currently the only knob is `ttlMs` — the per-trigger
   * trace-readiness debounce (ADR-026). `dedupKey`/`groupKey` above
   * remain the row-identity for the spec's row-leased architecture;
   * this codebase's GroupQueue-routed adapter uses `enqueueOptions.ttlMs`
   * to thread `trigger.traceDebounceMs` through to the settle stage's
   * Debounce Mode dedup window.
   */
  enqueueOptions?: {
    ttlMs?: number;
  };
}

/**
 * Definition of an outbox-backed reactor — a stake-sensitive
 * side-effect handler whose dispatch is durable, retried, and
 * operator-queryable.
 *
 * Use `.withOutbox(projection, name, definition)` instead of
 * `.withReactor(...)` when the side effect MUST not be silently
 * swallowed (customer emails, Slack messages, dataset writes). See
 * ADR-025 for the criteria.
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

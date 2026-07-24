import type { Event } from "../domain/types";
import type { DeduplicationStrategy } from "../queues/queue.types";

/** Metadata available to an event-only subscriber. Fold state is deliberately absent. */
export interface EventSubscriberContext {
  tenantId: string;
  aggregateId: string;
}

/**
 * Enqueue-time hooks evaluated at fan-out — in the routing worker, while the
 * committed event is already in memory — BEFORE any subscriber job is staged
 * (payload-cost doctrine invariant 4 — ADR-069).
 *
 * Both hooks run on the routing/dispatch path, so both share its failure
 * contract: a throw propagates into the routing retry (the committed event's
 * subscriber fan-out is retried), it is NEVER swallowed into a silent drop.
 * Keep them cheap and total.
 */
export interface EnqueueDispatchOptions<E extends Event = Event> {
  /**
   * Predicate deciding whether a job is staged at all. `false` → no job is ever
   * minted for this event (the cheapest job is the one that never exists). A
   * throw is NOT treated as `false`: it fails loudly into the routing retry.
   */
  filter?: (event: E) => boolean;
  /**
   * Projection applied at staging: when set, the staged job carries this small
   * payload instead of the full event, and the handler receives it (recovered
   * via `readStagedProjection`). Lift the slice here, where the payload is
   * already in memory, rather than re-buying the full payload in the handler.
   * Invoked only when `filter` (if any) returned `true`. A throw fails loudly
   * into the routing retry.
   */
  project?: (event: E) => unknown;
}

export interface EventSubscriberOptions<E extends Event = Event> {
  disabled?: boolean;
  delay?: number;
  deduplication?: DeduplicationStrategy<E>;
  groupKeyFn?: (event: E) => string;
  /**
   * Enqueue-time filter/projection hooks (ADR-069). When `project` is set the
   * handler receives the projection envelope for freshly staged jobs and the
   * full event for pre-upgrade jobs — it must discriminate the two shapes (see
   * `readStagedProjection`).
   */
  enqueue?: EnqueueDispatchOptions<E>;
}

/**
 * A live consumer of an event that has already been stored in the canonical
 * event log. The same event is carried through GroupQueue; subscribers do not
 * load it back from the event store and are not invoked by projection replay.
 *
 * Durable subscribers must make their own handling idempotent. Process
 * managers do that with their transactional inbox.
 */
export interface EventSubscriberDefinition<E extends Event = Event> {
  name: string;
  /** Empty means all event types. */
  eventTypes: readonly string[];
  handle: (event: E, context: EventSubscriberContext) => Promise<void>;
  options?: EventSubscriberOptions<E>;
}

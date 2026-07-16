import type { Event } from "../domain/types";
import type { DeduplicationStrategy } from "../queues/queue.types";

/** Metadata available to an event-only subscriber. Fold state is deliberately absent. */
export interface EventSubscriberContext {
  tenantId: string;
  aggregateId: string;
}

export interface EventSubscriberOptions<E extends Event = Event> {
  disabled?: boolean;
  delay?: number;
  deduplication?: DeduplicationStrategy<E>;
  groupKeyFn?: (event: E) => string;
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

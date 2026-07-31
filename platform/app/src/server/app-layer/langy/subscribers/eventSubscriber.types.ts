/**
 * Recovered from the deleted event-sourcing tree. Langy's own subscribers
 * (agent-turn-liveness, conversation-update-broadcast, turn-admission
 * lifecycle) are at-most-once consumers of the committed event, wired
 * outside `definePipeline` — the package's `SubscriberOn`/`BuiltSubscriber`
 * carry no delay/deduplication options, which these three depend on, so
 * there is no package type to repoint onto. Trimmed to the fields these
 * subscribers actually use (no killSwitch/enqueue/groupKeyFn — nothing here
 * used them).
 */

/**
 * An event as delivered to a subscriber, narrowed to its own type literal and
 * payload — `Type` is a literal so a union of these discriminates on `type`,
 * same as the deleted schema's `z.literal(...)` did.
 */
export interface SubscribedEvent<Type extends string, Data> {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly tenantId: string;
  readonly createdAt: number;
  readonly occurredAt: number;
  readonly type: Type;
  readonly version: string;
  readonly data: Data;
}

export interface EventSubscriberContext {
  tenantId: string;
  aggregateId: string;
}

export interface DeduplicationConfig<E> {
  /** Jobs with the same id are deduplicated within the TTL window. */
  makeId: (event: E) => string;
  /** @default 200 */
  ttlMs?: number;
}

export interface EventSubscriberOptions<E> {
  delay?: number;
  deduplication?: DeduplicationConfig<E>;
}

/**
 * A live consumer of an event that has already been stored in the canonical
 * event log. Durable subscribers must make their own handling idempotent.
 */
export interface EventSubscriberDefinition<E> {
  name: string;
  /** Empty means all event types. */
  eventTypes: readonly string[];
  handle: (event: E, context: EventSubscriberContext) => Promise<void>;
  options?: EventSubscriberOptions<E>;
}

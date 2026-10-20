import type { z } from "zod";

import type { AggregateType } from "../domain/aggregateType.ts";
import type { ParsingSchema } from "../domain/eventSchemas.ts";
import type { TenantId } from "../domain/tenantId.ts";
import type { Event, EventMetadataBase } from "../domain/types.ts";
import type { DeduplicationStrategy } from "../queues/queue.types.ts";

/**
 * A staged queue payload (ADR-069): a plain versioned job DTO a `stage` hook
 * may return in the committed event's place. Mirrors the event envelope's
 * scheduling identity but is NOT an event — never appended to the event log.
 */
export interface StagedJobPayload {
  id: string;
  aggregateId: string;
  aggregateType: AggregateType;
  tenantId: TenantId;
  createdAt: number;
  occurredAt: number;
  type: string;
  version: string;
  data: unknown;
  metadata?: EventMetadataBase;
  idempotencyKey?: string;
}

/** Metadata available to an event-only subscriber. Fold state is deliberately absent. */
export interface EventSubscriberContext {
  tenantId: string;
  aggregateId: string;
  /** The queue's 1-based delivery attempt; absent when the subscriber runs outside the queue. */
  deliveryAttempt?: number;
}

/**
 * Enqueue-time hooks (routing worker, pre-staging). A throw fails the staging,
 * which is recorded in the hand-off outbox and retried until it dead-letters.
 * See ADR-069 for payload-cost doctrine and deploy-order dependencies.
 */
export interface EnqueueDispatchOptions<E extends Event = Event> {
  /**
   * Total predicate: false means no job is staged; a throw fails the staging.
   * Use only cheap checks: set lookup, typeof, field comparison.
   */
  filter?: (event: E) => boolean;
  /**
   * Claim-check staging: swap payload for reference (ADR-069).
   * Must be total; introduces deploy-order dependency (consumer half must ship first).
   */
  stage?: (event: E) => Event | StagedJobPayload;
}

export interface EventSubscriberOptions<E extends Event = Event> {
  /** Compile-time off switch. */
  disabled?: boolean;
  delay?: number;
  deduplication?: DeduplicationStrategy<E>;
  groupKeyFn?: (event: E) => string;
  /**
   * Enqueue-time filter (ADR-069): declined events never mint a job. During a
   * rolling deploy, older jobs staged without the filter may still be queued —
   * a handler must stay correct for events its filter would have declined.
   */
  enqueue?: EnqueueDispatchOptions<E>;
  /**
   * Most due same-group jobs the queue drains into one `handleBatch` call (ADR-066).
   * Defaults to 1, no coalescing; above 1 the definition must declare `handleBatch`.
   */
  coalesceMaxBatch?: number;
}

/**
 * A live consumer of an event already stored in the canonical event log,
 * carried through GroupQueue — never loaded back from the store, never
 * invoked by replay. Durable subscribers must make their own handling idempotent.
 */
export interface EventSubscriberDefinition<E extends Event = Event> {
  name: string;
  /** Empty means all event types. */
  eventTypes: readonly string[];
  handle: (event: E, context: EventSubscriberContext) => Promise<void>;
  /**
   * A coalesced batch of one tenant's events in queue order, `contexts[i]` for `events[i]`.
   * A throw fails the whole batch, which the queue splits and retries. A single delivery
   * still calls `handle`.
   */
  handleBatch?: (
    events: readonly E[],
    contexts: readonly EventSubscriberContext[],
  ) => Promise<void>;
  options?: EventSubscriberOptions<E>;
}

/**
 * A module's subscriber on a peer pipeline's event (§9), by contract event type and data schema.
 * Delivered at least once, per aggregate ordered, never replayed: the handler is idempotent and
 * throws to be retried. It declares one of `handle` (one event) or `handleBatch` (a batch).
 */
export type PeerSubscriberDefinition<Data extends ParsingSchema> =
  | PeerEventSubscriberDefinition<Data>
  | PeerBatchSubscriberDefinition<Data>;

/** A peer subscriber handed one event per call. */
export type PeerEventSubscriberDefinition<Data extends ParsingSchema> =
  PeerSubscriberDeclaration<Data> & {
    handle: (data: z.output<Data>, context: PeerSubscriberContext) => Promise<void>;
    handleBatch?: never;
  };

/** A peer subscriber handed every delivery as a batch, so a backed-up group drains in one call. */
export type PeerBatchSubscriberDefinition<Data extends ParsingSchema> =
  PeerSubscriberDeclaration<Data> & {
    /**
     * Every delivery: a single job as a batch of one, a coalesced group (up to
     * `options.coalesceMaxBatch`) in queue order. All items share one tenant; a throw,
     * including a data parse failure, fails the batch, which the queue splits and retries.
     */
    handleBatch: (items: readonly PeerSubscriberBatchItem<Data>[]) => Promise<void>;
    handle?: never;
  };

/** What a peer subscriber declares besides its handler. */
interface PeerSubscriberDeclaration<Data extends ParsingSchema> {
  eventType: string;
  data: Data;
  /**
   * Enqueue shaping as an event subscriber declares it: delay, dedup, group lane and filter.
   * `coalesceMaxBatch` above 1 needs `handleBatch`.
   */
  options?: Pick<
    EventSubscriberOptions,
    "delay" | "deduplication" | "groupKeyFn" | "coalesceMaxBatch"
  > & {
    enqueue?: PeerSubscriberEnqueueOptions<Data>;
  };
}

/** One event of a coalesced peer batch: its parsed data and the context `handle` would get. */
export interface PeerSubscriberBatchItem<Data extends ParsingSchema> {
  data: z.output<Data>;
  context: PeerSubscriberContext;
}

/** A peer subscriber's enqueue-time filter, over the data its handler would be handed. */
export interface PeerSubscriberEnqueueOptions<Data extends ParsingSchema> {
  /** False mints no job. Data the schema refuses is staged, so the handler's parse reports it. */
  filter?: (data: z.output<Data>) => boolean;
}

/**
 * A peer subscriber's context: the event's tenant, aggregate, instant, id (a k-sortable cursor)
 * and, when the event carries one, its idempotency key: two appends of one fact share the key
 * but not the id, so a handler deduping per fact keys on `idempotencyKey ?? eventId`.
 */
export interface PeerSubscriberContext extends EventSubscriberContext {
  occurredAt: number;
  /** When the owner appended the event (processing time), beside occurredAt's business time. */
  createdAt: number;
  eventId: string;
  idempotencyKey?: string;
}

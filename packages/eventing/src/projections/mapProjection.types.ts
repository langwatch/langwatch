import type { TenantId } from "../domain/tenantId.ts";
import type { Event } from "../domain/types.ts";
import type { KillSwitchOptions } from "../kill-switch/killSwitchKeys.ts";
import type { RetentionPolicy } from "../runtime.types.ts";
import type { EnqueueDispatchOptions } from "../subscribers/eventSubscriber.types.ts";
import type { ProjectionStoreContext } from "./projectionStoreContext.ts";

/**
 * Stateless projection: pure map function transforms each event into a record
 * (or null to skip). No accumulated state; unlike FoldProjection.
 */
export interface MapProjectionDefinition<Record, E extends Event = Event> {
  /** Unique name for this projection within the pipeline. */
  name: string;

  /** Event types this projection reacts to. Used by the router to dispatch. */
  eventTypes: readonly string[];

  /**
   * Pure function: transforms an event into a record for storage.
   * Return null to skip storage for this event.
   */
  map: (event: E) => Record | null;

  /** Store for appending records. */
  store: AppendStore<Record>;

  /** Optional processing behavior configuration. */
  options?: MapProjectionOptions<E>;

  /**
   * Loads events up to upToEvent with idempotency-key dedup. Auto-wired by
   * EventSourcingService; used for dedupeByIdempotencyKey.
   */
  eventLoaderUpTo?: (context: {
    tenantId: string;
    aggregateId: string;
    upToEvent: Event;
  }) => Promise<Event[]>;
}

/**
 * Map-projection enqueue-time filter seam: filter must never reject what map()
 * would map (superset safe, subset is silent data loss). Derive both from one
 * declaration.
 */
export type MapEnqueueDispatchOptions<E extends Event = Event> = Pick<
  EnqueueDispatchOptions<E>,
  "filter"
>;

/**
 * Options for configuring map projection processing behavior. Generic in the
 * projection's own event type for typed filters.
 */
export interface MapProjectionOptions<E extends Event = Event> {
  /**
   * Operator stop for this component, resolved per tenant at dispatch time.
   * Absent means the generated key; a `customKey` must also be what the
   * descriptors advertise or the switch cannot be set.
   */
  killSwitch?: KillSwitchOptions;
  /** Concurrency limit for processing jobs. */
  concurrency?: number;

  /** Whether to disable this projection. */
  disabled?: boolean;

  /** Custom group key function for routing; enables per-item parallelism. */
  groupKeyFn?: (event: E) => string;

  /**
   * Enqueue-time gate: an event this projection would map to `null` never
   * mints a job. Evaluated at fan-out after the event-type match.
   */
  enqueue?: MapEnqueueDispatchOptions<E>;

  /**
   * Maximum same-group events to persist through one `bulkAppend` call.
   * Requires the store to implement `bulkAppend`; the queue keeps the batch
   * tenant-scoped because tenant identity is always part of its group key.
   */
  coalesceMaxBatch?: number;

  /**
   * Skip duplicate deliveries with the same idempotencyKey. Fails open on
   * read lag (worst case: transient over-count, never undercount).
   */
  dedupeByIdempotencyKey?: boolean;
}

/**
 * Tenant-scoped context for bulk appends. Unlike the per-event
 * {@link ProjectionStoreContext}, a bulk write batches MANY aggregates into
 * one insert, so there is deliberately no `aggregateId` — carry it on the record.
 */
export interface BulkAppendContext {
  /** Tenant identifier for multi-tenant isolation (e.g. CH client routing). */
  tenantId: TenantId;

  /**
   * Resolved retention policy for the tenant. Absent/null means the resolver
   * could not produce a value; the write path then stamps the platform
   * default, never indefinite.
   */
  retentionPolicy?: RetentionPolicy | null;
}

/**
 * Store interface for map projections.
 * Appends individual records produced by the map function.
 */
export interface AppendStore<Record> {
  /** Appends a single record to the store. */
  append: (record: Record, context: ProjectionStoreContext) => Promise<void>;

  /**
   * Appends multiple records in a single batch. Used by replay for bulk
   * writes. Records within one call may span many aggregates of the same
   * tenant, so the context is tenant-scoped ({@link BulkAppendContext}).
   */
  bulkAppend?: (records: Record[], context: BulkAppendContext) => Promise<void>;
}

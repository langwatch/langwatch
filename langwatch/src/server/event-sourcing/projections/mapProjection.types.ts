import type { ResolvedRetention } from "../../data-retention/retentionPolicy.schema";
import type { TenantId } from "../domain/tenantId";
import type { Event } from "../domain/types";
import type { KillSwitchOptions } from "../pipeline/staticBuilder.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * A stateless projection that transforms individual events into records.
 *
 * MapProjection replaces the old EventHandler interface for the common case
 * of mapping a single event to a stored record. The `map` function is pure
 * — it receives an event and returns a record (or null to skip). The
 * framework handles dispatch and persistence via the AppendStore.
 *
 * Unlike FoldProjection, MapProjection has no accumulated state — each
 * event is processed independently.
 *
 * @example
 * ```typescript
 * const spanStorage: MapProjectionDefinition<NormalizedSpan, SpanReceivedEvent> = {
 *   name: "spanStorage",
 *   eventTypes: ["lw.obs.trace.span_received"],
 *   map: (event) => normalizeSpan(event.tenantId, event.data.span, ...),
 *   store: spanAppendStore,
 * };
 * ```
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
  map(event: E): Record | null;

  /** Store for appending records. */
  store: AppendStore<Record>;

  /** Optional processing behavior configuration. */
  options?: MapProjectionOptions;

  /**
   * Loads the aggregate's events up to AND INCLUDING `upToEvent` in log
   * order, sorted by occurredAt ASC, with the store's idempotency-key dedup
   * applied (first occurrence per key wins). Used by the executor for
   * `options.dedupeByIdempotencyKey`.
   *
   * Auto-wired by EventSourcingService at registration time, like the fold
   * projections' `eventLoaderUpTo`.
   */
  eventLoaderUpTo?: (context: {
    tenantId: string;
    aggregateId: string;
    upToEvent: Event;
  }) => Promise<Event[]>;
}

/**
 * Options for configuring map projection processing behavior.
 */
export interface MapProjectionOptions {
  /** Kill switch configuration. When enabled, the projection is disabled. */
  killSwitch?: KillSwitchOptions;

  /** Concurrency limit for processing jobs. */
  concurrency?: number;

  /** Whether to disable this projection. */
  disabled?: boolean;

  /** Custom group key function for queue routing. Enables per-item parallelism instead of per-aggregate serialization. */
  groupKeyFn?: (event: any) => string;

  /**
   * Maximum same-group events to persist through one `bulkAppend` call.
   *
   * Only honoured when the store implements `bulkAppend`. A store without it
   * keeps per-event delivery and this option is ignored, with a warning at
   * registration. That is a correctness requirement rather than an
   * optimisation: queue delivery is at-least-once, so a batch that failed
   * half-way through a per-record loop would duplicate its already-committed
   * prefix when the queue re-ran it.
   *
   * The queue keeps the batch tenant-scoped because tenant identity is always
   * part of its group key.
   */
  coalesceMaxBatch?: number;

  /**
   * Skip events that are DUPLICATE deliveries of an earlier event with the
   * same `idempotencyKey`.
   *
   * The event log is append-only and at-least-once: a client re-report
   * (deterministic ids, SDK retries) appends a SECOND event row with the
   * invoked once per appended event — for an additive sink (an
   * AggregatingMergeTree rollup) that means the increment lands twice,
   * SYSTEMATICALLY for write paths designed around retries.
   *
   * With this option, the executor checks the aggregate's event history
   * before mapping: if an EARLIER event holds this event's idempotency key,
   * the delivery is a duplicate and is skipped. Fail-open — when the
   * history read cannot see the key holder (event-log read lag), the event
   * is mapped, so the worst case remains the rare transient over-count the
   * projection already tolerates, never an undercount.
   *
   * Costs one event-log read per mapped event carrying an idempotency key;
   * only enable on low-volume streams (evaluations — not spans).
   */
  dedupeByIdempotencyKey?: boolean;
}

/**
 * Tenant-scoped context for bulk appends.
 *
 * Unlike the per-event {@link ProjectionStoreContext}, a bulk write batches
 * records from MANY aggregates of one tenant into a single insert, so there is
 * deliberately no `aggregateId` here — anything a store needs per row must be
 * carried on the record itself.
 */
export interface BulkAppendContext {
  /** Tenant identifier for multi-tenant isolation (e.g. CH client routing). */
  tenantId: TenantId;

  /**
   * Resolved retention policy for the tenant. Absent/null means the resolver
   * could not produce a value; the write path then stamps
   * PLATFORM_DEFAULT_RETENTION_DAYS, never indefinite — see
   * {@link ProjectionStoreContext.retentionPolicy}.
   */
  retentionPolicy?: ResolvedRetention | null;
}

/**
 * Store interface for map projections.
 * Appends individual records produced by the map function.
 */
export interface AppendStore<Record> {
  /** Appends a single record to the store. */
  append(record: Record, context: ProjectionStoreContext): Promise<void>;

  /**
   * Appends multiple records in a single batch. Used by replay for bulk
   * writes. Records within one call may span many aggregates of the same
   * tenant, so the context is tenant-scoped ({@link BulkAppendContext}).
   */
  bulkAppend?(records: Record[], context: BulkAppendContext): Promise<void>;
}

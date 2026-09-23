import { z } from "zod";

import type { AggregateType } from "../domain/aggregateType.ts";
import { type TenantId, TenantIdSchema } from "../domain/tenantId.ts";
import type { Event } from "../domain/types.ts";

/**
 * Event store read context; tenantId is REQUIRED for tenant isolation.
 */
export const EventStoreReadContextSchema = z.object({
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all operations must be scoped to a specific tenant for security.
   */
  tenantId: TenantIdSchema,
  /**
   * Additional metadata for the read operation.
   * Should not be used to bypass security checks.
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /**
   * Raw/implementation-specific context.
   * Use with caution - should not bypass security or validation.
   */
  raw: z.record(z.string(), z.unknown()).optional(),
});

export interface EventStoreReadContext<_EventType extends Event = Event> {
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all operations must be scoped to a specific tenant for security.
   */
  tenantId: TenantId;
  /**
   * Additional metadata for the read operation.
   * Should not be used to bypass security checks.
   */
  metadata?: Record<string, unknown>;
  /**
   * Raw/implementation-specific context.
   * Use with caution - should not bypass security or validation.
   */
  raw?: Record<string, unknown>;
  /**
   * Which delivery of the job carrying this read is being processed: 1 for a
   * fresh delivery, higher for a retry of a chain that has not acked. Absent
   * outside the queue, e.g. during replay.
   */
  deliveryAttempt?: number;
  /**
   * True when this is a later sub-batch of the same locked dispatch, an
   * earlier one already committed (GroupQueue bisection). A fold commit must
   * EXTEND the applied-event-id set, not replace it, or a retry re-applies ids (#6578).
   */
  isDeliveryContinuation?: boolean;
}

/** Required boundary for one immutable event-log read. */
export interface EventStoreEventReadInput {
  eventId: string;
  tenantId: TenantId;
  aggregateType: AggregateType;
  aggregateId: string;
}

/**
 * Read-only event store; enforces tenant isolation and returns readonly arrays.
 */
export interface ReadOnlyEventStore<EventType extends Event = Event> {
  /**
   * Reads one immutable event inside a tenant-bound aggregate stream. The
   * stream boundary is mandatory: a missing event and a mismatched tenant or
   * stream both fail as not found, so this can't enumerate another tenant's log.
   */
  getEvent(input: EventStoreEventReadInput): Promise<EventType>;

  /**
   * Retrieves all events for an aggregate; optional anchorOccurredAtMs lets
   * time-local stores prune old partitions. Validates tenant isolation before queries.
   */
  getEvents(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    anchorOccurredAtMs?: number,
  ): Promise<readonly EventType[]>;

  /**
   * Retrieves events with explicit occurred-at lower bound; caller must provide sufficient
   * safety margin. Validates tenantId like getEvents.
   */
  getEventsOccurredSince(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    occurredAtFromMs: number,
  ): Promise<readonly EventType[]>;

  /**
   * Retrieves events up to and including a specific event; validates tenant isolation.
   */
  getEventsUpTo(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    upToEvent: EventType,
  ): Promise<readonly EventType[]>;

  /**
   * Cursor-paginated variant of getEventsUpTo; enables paging large histories without
   * materializing all events. Optional: callers must check presence and fall back to getEventsUpTo.
   */
  getEventsUpToPaged?(request: {
    aggregateId: string;
    context: EventStoreReadContext<EventType>;
    aggregateType: AggregateType;
    upToEvent: EventType;
    after: { timestamp: number; eventId: string } | undefined;
    limit: number;
  }): Promise<readonly EventType[]>;

  /**
   * Counts events before a given event; should use efficient COUNT with indexes for
   * performance. Validates tenantId for security.
   */
  countEventsBefore(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    beforeTimestamp: number,
    beforeEventId: string,
  ): Promise<number>;
}

/**
 * Full event store with read and write capabilities; validates events and enforces
 * tenant isolation.
 */
export interface EventStore<EventType extends Event = Event> extends ReadOnlyEventStore<EventType> {
  /**
   * Stores events atomically; validates and verifies tenant ownership before storage.
   */
  storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<void>;
}

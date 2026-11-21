import type { EventLogPageCursor } from "../event-log-page-order.ts";

/**
 * Event record format used by repositories for data storage.
 * This is the raw format stored in the database/memory.
 */
export interface EventRecord {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventTimestamp: number;
  EventOccurredAt: number | null;
  EventType: string;
  EventVersion: string;
  EventPayload: unknown;
  ProcessingTraceparent: string;
  IdempotencyKey: string;
  _retention_days?: number;
}

/** Inclusive EventOccurredAt bounds, in epoch milliseconds. */
export interface EventOccurredAtWindow {
  fromMs: number;
  toMs: number;
}

/**
 * What one replica of the event log shows about an aggregate around one of its events: whether
 * it holds that event, and whether it holds any event the log accepted before it.
 */
export interface EventLogProbe {
  hasEvent: boolean;
  hasEarlierEvents: boolean;
}

/**
 * Repository interface for event data access: raw CRUD operations without
 * business logic. Validation, transformation and deduplication belong to the
 * store layer that uses this repository.
 */
export interface EventRepository {
  /**
   * Reads one durable event inside its tenant-bound aggregate stream.
   * `event_log` event ids are immutable, but the full stream key is still
   * required — never turn an event id into a cross-tenant lookup or an unbounded scan.
   */
  getEventRecord(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    eventId: string;
    /** Partition-pruning bound on EventOccurredAt; a row with no occurred time always matches. */
    occurredAt?: EventOccurredAtWindow;
  }): Promise<EventRecord>;

  /**
   * Retrieves event records; occurredAtFromMs is partition-pruning only, must not
   * change result set for correctly-classified aggregates.
   */
  getEventRecords(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    occurredAtFromMs?: number;
  }): Promise<EventRecord[]>;

  /**
   * Every record of many aggregates of one type in one read, in log order per aggregate; a
   * record whose tenant and aggregate pair was not asked for is never answered.
   */
  findEventRecordsOfAggregates(request: {
    aggregates: readonly { tenantId: string; aggregateId: string }[];
    aggregateType: string;
  }): Promise<EventRecord[]>;

  /**
   * Retrieves event records up to a specific event; occurredAtFromMs prunes
   * partitions. Filters by timestamp and eventId.
   */
  getEventRecordsUpTo(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    upToTimestamp: number;
    upToEventId: string;
    occurredAtFromMs?: number;
  }): Promise<EventRecord[]>;

  /**
   * Cursor-paginated variant; streams history page-by-page for large aggregates.
   * Optional: callers detect absence and fall back to getEventRecordsUpTo. Pages come in
   * key order, not time order (see EventLogPageCursor).
   */
  getEventRecordsUpToPaged?: (request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    upToTimestamp: number;
    upToEventId: string;
    after: EventLogPageCursor | undefined;
    limit: number;
    /** Partition-pruning lower bound — see {@link EventRepository.getEventRecordsUpTo}. */
    occurredAtFromMs?: number;
  }) => Promise<EventRecord[]>;

  /**
   * Counts event records that come before a given event.
   * Returns raw count without validation.
   */
  countEventRecords(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    beforeTimestamp: number;
    beforeEventId: string;
  }): Promise<number>;

  /**
   * Whether the log holds an event and any event accepted before it, without reading either:
   * each answer stops at its first row. `occurredAtFromMs` only prunes partitions.
   */
  probeEventRecordsBefore(request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    eventTimestamp: number;
    eventId: string;
    occurredAtFromMs?: number;
    ignoreEventIds?: readonly string[];
  }): Promise<EventLogProbe>;

  /**
   * Inserts event records into storage.
   * Does not validate or transform records.
   */
  insertEventRecords(records: EventRecord[]): Promise<void>;
}

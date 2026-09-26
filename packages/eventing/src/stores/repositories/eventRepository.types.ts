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
   * Optional: callers detect absence and fall back to getEventRecordsUpTo.
   */
  getEventRecordsUpToPaged?: (request: {
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    upToTimestamp: number;
    upToEventId: string;
    after: { timestamp: number; eventId: string } | undefined;
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
   * Inserts event records into storage.
   * Does not validate or transform records.
   */
  insertEventRecords(records: EventRecord[]): Promise<void>;
}

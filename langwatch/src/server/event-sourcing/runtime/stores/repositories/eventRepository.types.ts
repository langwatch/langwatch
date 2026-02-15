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
}

/**
 * Repository interface for event data access.
 * Handles raw CRUD operations without business logic.
 *
 * **Pure Data Access**: This interface only handles raw read/write operations.
 * All business logic (validation, transformation, deduplication) must be
 * handled by the store layer that uses this repository.
 */
export interface EventRepository {
  /**
   * Retrieves all event records for a given aggregate.
   * Returns raw records without validation or transformation.
   */
  getEventRecords(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<EventRecord[]>;

  /**
   * Retrieves event records up to and including a specific event.
   * Returns raw records without validation or transformation.
   * Events are filtered where:
   * - timestamp < upToTimestamp, OR
   * - timestamp = upToTimestamp AND eventId <= upToEventId
   */
  getEventRecordsUpTo(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    upToTimestamp: number,
    upToEventId: string,
  ): Promise<EventRecord[]>;

  /**
   * Counts event records that come before a given event.
   * Returns raw count without validation.
   */
  countEventRecords(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    beforeTimestamp: number,
    beforeEventId: string,
  ): Promise<number>;

  /**
   * Inserts event records into storage.
   * Does not validate or transform records.
   */
  insertEventRecords(records: EventRecord[]): Promise<void>;
}

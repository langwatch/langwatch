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
  EventType: string;
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


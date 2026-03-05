import { createLogger } from "~/utils/logger/server";
import type { EventRecord, EventRepository } from "./eventRepository.types";

const logger = createLogger("langwatch:event-sourcing:event-repository-memory");

/**
 * In-memory implementation of EventRepository.
 * Stores events in a Map keyed by tenantId:aggregateType:aggregateId.
 *
 * **WARNING: NOT THREAD-SAFE**
 * This implementation is NOT safe for concurrent access.
 */
export class EventRepositoryMemory implements EventRepository {
  // Partition by tenant + aggregateType + aggregateId
  private readonly eventsByKey = new Map<string, EventRecord[]>();

  async getEventRecords(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<EventRecord[]> {
    const key = `${tenantId}:${aggregateType}:${String(aggregateId)}`;
    const records = this.eventsByKey.get(key) ?? [];
    // Return a copy to prevent mutation
    return records.map((record) => ({ ...record }));
  }

  async getEventRecordsUpTo(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    upToTimestamp: number,
    upToEventId: string,
  ): Promise<EventRecord[]> {
    const key = `${tenantId}:${aggregateType}:${String(aggregateId)}`;
    const records = this.eventsByKey.get(key) ?? [];

    // Filter events up to and including the specified event
    // Events where: timestamp < upToTimestamp OR (timestamp = upToTimestamp AND eventId <= upToEventId)
    const filteredRecords = records.filter((record) => {
      if (record.EventTimestamp < upToTimestamp) {
        return true;
      }
      if (
        record.EventTimestamp === upToTimestamp &&
        record.EventId <= upToEventId
      ) {
        return true;
      }
      return false;
    });

    // Sort by timestamp then eventId to ensure consistent ordering
    const sortedRecords = [...filteredRecords].sort((a, b) => {
      if (a.EventTimestamp !== b.EventTimestamp) {
        return a.EventTimestamp - b.EventTimestamp;
      }
      return a.EventId.localeCompare(b.EventId);
    });

    // Return a copy to prevent mutation
    return sortedRecords.map((record) => ({ ...record }));
  }

  async countEventRecords(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    beforeTimestamp: number,
    beforeEventId: string,
  ): Promise<number> {
    const key = `${tenantId}:${aggregateType}:${String(aggregateId)}`;
    const records = this.eventsByKey.get(key) ?? [];

    // Count records where: (timestamp < beforeTimestamp) OR (timestamp === beforeTimestamp AND id < beforeEventId)
    return records.filter((record) => {
      if (record.EventTimestamp < beforeTimestamp) {
        return true;
      }
      if (
        record.EventTimestamp === beforeTimestamp &&
        record.EventId < beforeEventId
      ) {
        return true;
      }
      return false;
    }).length;
  }

  async insertEventRecords(records: EventRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    for (const record of records) {
      const key = `${record.TenantId}:${record.AggregateType}:${String(record.AggregateId)}`;
      const aggregateEvents = this.eventsByKey.get(key) ?? [];

      // Prevent duplicates by checking if event with same ID already exists
      const alreadyExists = aggregateEvents.some(
        (e) => e.EventId === record.EventId,
      );
      if (alreadyExists) {
        // Log duplicate attempt for observability
        if (process.env.NODE_ENV !== "test") {
          logger.warn(
            {
              eventId: record.EventId,
              aggregateId: record.AggregateId,
              tenantId: record.TenantId,
            },
            "Duplicate event detected and skipped",
          );
        }
        continue;
      }

      // Deep clone to prevent mutation
      aggregateEvents.push({
        ...record,
        EventPayload:
          typeof record.EventPayload === "object" &&
          record.EventPayload !== null
            ? JSON.parse(JSON.stringify(record.EventPayload))
            : record.EventPayload,
      });
      this.eventsByKey.set(key, aggregateEvents);
    }
  }
}

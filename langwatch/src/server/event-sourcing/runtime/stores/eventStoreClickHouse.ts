import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type {
  EventStore as BaseEventStore,
  EventStoreReadContext,
  Event,
  AggregateType,
} from "../../library";
import { EventUtils, createTenantId } from "../../library";
import { createLogger } from "../../../../utils/logger";
import type {
  EventRepository,
  EventRecord,
} from "./repositories/eventRepository.types";
import {
  ValidationError,
  SecurityError,
  StoreError,
  ErrorCategory,
} from "../../library/services/errorHandling";

export class EventStoreClickHouse<EventType extends Event = Event>
  implements BaseEventStore<EventType>
{
  tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-store.clickhouse",
  );
  logger = createLogger("langwatch:trace-processing:event-store:clickhouse");

  constructor(private readonly repository: EventRepository) {}

  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<readonly EventType[]> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "EventStoreClickHouse.getEvents");

    return await this.tracer.withActiveSpan(
      "EventStoreClickHouse.getEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": String(aggregateId),
          "tenant.id": context.tenantId,
          "aggregate.type": aggregateType,
        },
      },
      async () => {
        try {
          // Get raw records from repository
          const records = await this.repository.getEventRecords(
            context.tenantId,
            aggregateType,
            aggregateId,
          );

          // Transform records to events
          const events = records.map((record) =>
            this.recordToEvent(record, aggregateId),
          );

          // Deduplicate by Event ID (keep first occurrence when sorted by timestamp)
          const seenEventIds = new Set<string>();
          const deduplicatedEvents = events.filter((event) => {
            if (!event.id) {
              // If no Event ID, keep the event (shouldn't happen but handle gracefully)
              return true;
            }
            if (seenEventIds.has(event.id)) {
              return false; // Skip duplicate
            }
            seenEventIds.add(event.id);
            return true;
          });

          return deduplicatedEvents;
        } catch (error) {
          this.logger.error(
            {
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
              aggregateType,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
              errorName: error instanceof Error ? error.name : void 0,
            },
            "Failed to get events from ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  async countEventsBefore(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    beforeTimestamp: number,
    beforeEventId: string,
  ): Promise<number> {
    // Validate tenant context
    EventUtils.validateTenantId(
      context,
      "EventStoreClickHouse.countEventsBefore",
    );

    return await this.tracer.withActiveSpan(
      "EventStoreClickHouse.countEventsBefore",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": String(aggregateId),
          "tenant.id": context.tenantId,
          "aggregate.type": aggregateType,
          "before.timestamp": beforeTimestamp,
          "before.event_id": beforeEventId,
        },
      },
      async () => {
        try {
          // Delegate to repository
          return await this.repository.countEventRecords(
            context.tenantId,
            aggregateType,
            aggregateId,
            beforeTimestamp,
            beforeEventId,
          );
        } catch (error) {
          this.logger.error(
            {
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
              aggregateType,
              beforeTimestamp,
              beforeEventId,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
              errorName: error instanceof Error ? error.name : void 0,
            },
            "Failed to count events before from ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "EventStoreClickHouse.storeEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": context.tenantId,
          "event.count": events.length,
          "aggregate.type": aggregateType,
        },
      },
      async () => {
        try {
          EventUtils.validateTenantId(
            context,
            "EventStoreClickHouse.storeEvents",
          );

          if (events.length === 0) {
            return;
          }

          // Validate all events before storage
          this.validateEvents(events, context, aggregateType);

          // Transform events to records
          const records = events.map((event) => this.eventToRecord(event));

          // Delegate to repository
          await this.repository.insertEventRecords(records);

          this.logger.info(
            {
              tenantId: context.tenantId,
              eventCount: events.length,
              aggregateIds: [...new Set(events.map((e) => e.aggregateId))],
            },
            "Stored events to ClickHouse",
          );
        } catch (error) {
          this.logger.error(
            {
              tenantId: context.tenantId,
              eventCount: events.length,
              aggregateIds: [
                ...new Set(events.map((e) => String(e.aggregateId))),
              ],
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
              errorName: error instanceof Error ? error.name : void 0,
            },
            "Failed to store events in ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Validates all events before storage.
   * Security checks (tenantId) MUST happen before validation checks.
   */
  private validateEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): void {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event) {
        throw new ValidationError(
          `Event at index ${i} is undefined`,
          "event",
          void 0,
          { index: i },
        );
      }

      this.validateEventTenant(event, context, i);
      this.validateEventAggregateType(event, aggregateType, i);
      this.validateEventStructure(event, context, i);
    }
  }

  /**
   * Validates event aggregate type matches context aggregate type.
   */
  private validateEventAggregateType(
    event: EventType,
    aggregateType: AggregateType,
    index: number,
  ): void {
    if (event.aggregateType !== aggregateType) {
      this.logger.error(
        {
          tenantId: event.tenantId,
          eventIndex: index,
          aggregateType,
        },
        "Aggregate type mismatch in event batch",
      );
      throw new ValidationError(
        `Event at index ${index} has aggregate type '${event.aggregateType}' that does not match pipeline aggregate type '${aggregateType}'`,
        "aggregateType",
        event.aggregateType,
        { index, expectedAggregateType: aggregateType },
      );
    }
  }

  /**
   * Validates event tenant ID matches context.
   */
  private validateEventTenant(
    event: EventType,
    context: EventStoreReadContext<EventType>,
    index: number,
  ): void {
    const eventTenantId = event.tenantId;
    if (!eventTenantId) {
      const error = new SecurityError(
        "validateEventTenant",
        `Event at index ${index} has no tenantId`,
        void 0,
        { index },
      );
      this.logger.error(
        {
          tenantId: context.tenantId,
          eventIndex: index,
          aggregateId: String(event.aggregateId),
          eventType: event.type,
        },
        "Event has no tenantId",
      );
      throw error;
    }

    if (eventTenantId !== context.tenantId) {
      const error = new SecurityError(
        "validateEventTenant",
        `Event at index ${index} has tenantId '${eventTenantId}' that does not match context tenantId '${context.tenantId}'`,
        void 0,
        { index },
      );
      this.logger.error(
        {
          tenantId: context.tenantId,
          eventIndex: index,
          eventTenantId,
          aggregateId: String(event.aggregateId),
        },
        "Tenant mismatch in event batch",
      );
      throw error;
    }
  }

  /**
   * Validates event structure.
   */
  private validateEventStructure(
    event: EventType,
    context: EventStoreReadContext<EventType>,
    index: number,
  ): void {
    if (!EventUtils.isValidEvent(event)) {
      const eventRecord = event as Record<string, unknown>;
      this.logger.error(
        {
          tenantId: context.tenantId,
          eventIndex: index,
          aggregateId: String(eventRecord.aggregateId ?? "unknown"),
          eventType: String(eventRecord.type ?? "unknown"),
        },
        "Invalid event rejected",
      );
      throw new ValidationError(
        `Invalid event at index ${index}: event must have id, aggregateId, timestamp, type, and data`,
        "event",
        event,
        { index },
      );
    }
  }

  /**
   * Transforms an EventRecord to an Event.
   */
  private recordToEvent(record: EventRecord, aggregateId: string): EventType {
    // Handle invalid timestamps by falling back to current time
    let timestampMs: number;
    if (
      typeof record.EventTimestamp === "number" &&
      !Number.isNaN(record.EventTimestamp)
    ) {
      timestampMs = record.EventTimestamp;
    } else if (typeof record.EventTimestamp === "string") {
      const parsed = Date.parse(record.EventTimestamp);
      timestampMs = Number.isNaN(parsed) ? Date.now() : parsed;
    } else {
      timestampMs = Date.now();
    }
    const payload = this.parseEventPayload(record.EventPayload);

    // Construct event object matching Event interface structure
    // We first check the type is valid using satisfies, then cast to EventType
    // since EventType is a generic that could be a more specific subtype, but
    // we have already checked the type is valid using satisfies, so we can cast
    // to EventType. TypeScript just isn't as clever as we are. hehe.
    const event = {
      id: record.EventId,
      aggregateId: aggregateId,
      aggregateType: record.AggregateType as AggregateType,
      tenantId: createTenantId(record.TenantId),
      timestamp: timestampMs,
      type: record.EventType as EventType["type"],
      data: payload,
      metadata: {
        processingTraceparent: record.ProcessingTraceparent || void 0,
      },
    } satisfies Event;

    return event as EventType;
  }

  /**
   * Transforms an Event to an EventRecord.
   */
  private eventToRecord(event: EventType): EventRecord {
    return {
      TenantId: String(event.tenantId),
      AggregateType: event.aggregateType,
      AggregateId: String(event.aggregateId),
      EventId: event.id,
      EventTimestamp: event.timestamp,
      EventType: event.type,
      EventPayload: event.data ?? {},
      ProcessingTraceparent: event.metadata?.processingTraceparent ?? "",
    };
  }

  /**
   * Parses the EventPayload from ClickHouse query results.
   *
   * ClickHouse can return Object-type columns in different formats depending on
   * the query format and data storage:
   * - As a JSON string (when stored as string or returned via certain formats)
   * - As a parsed object (when ClickHouse automatically parses it)
   * - As an empty string (which should be treated as null)
   *
   * This helper normalizes all these cases into a consistent parsed payload.
   *
   * @param rawPayload - The raw EventPayload value from ClickHouse (string, object, or other)
   * @returns The parsed payload (object, null, or primitive value)
   * @throws Error if the payload is in an unexpected format (corrupted data)
   */
  private parseEventPayload(rawPayload: unknown): unknown {
    if (typeof rawPayload === "string") {
      if (rawPayload.length === 0) {
        return null;
      } else {
        return JSON.parse(rawPayload);
      }
    } else if (typeof rawPayload === "object") {
      return rawPayload;
    } else {
      throw new StoreError(
        "parsePayload",
        "EventStoreClickHouse",
        `EventPayload is not a string or object, it is of type ${typeof rawPayload}`,
        ErrorCategory.CRITICAL,
        { rawPayloadType: typeof rawPayload },
      );
    }
  }
}

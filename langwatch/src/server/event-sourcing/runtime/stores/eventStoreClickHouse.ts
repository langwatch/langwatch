import { type ClickHouseClient } from "@clickhouse/client";
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

interface EventRecord {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventTimestamp: number;
  EventType: string;
  EventPayload: unknown;
  ProcessingTraceparent: string;
}

export class EventStoreClickHouse<EventType extends Event = Event>
  implements BaseEventStore<EventType>
{
  tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-store.clickhouse",
  );
  logger = createLogger("langwatch:trace-processing:event-store:clickhouse");

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

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
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                EventId,
                EventTimestamp,
                EventType,
                EventPayload,
                ProcessingTraceparent
              FROM event_log
              WHERE TenantId = {tenantId:String}
                AND AggregateType = {aggregateType:String}
                AND AggregateId = {aggregateId:String}
              ORDER BY EventTimestamp ASC, EventId ASC
            `,
            query_params: {
              tenantId: context.tenantId,
              aggregateType,
              aggregateId: String(aggregateId),
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<EventRecord>();

          return rows.map((row) => {
            // EventTimestamp is already a number (Unix timestamp in milliseconds)
            // Handle invalid timestamps by falling back to current time
            let timestampMs: number;
            if (
              typeof row.EventTimestamp === "number" &&
              !Number.isNaN(row.EventTimestamp)
            ) {
              timestampMs = row.EventTimestamp;
            } else if (typeof row.EventTimestamp === "string") {
              const parsed = Date.parse(row.EventTimestamp);
              timestampMs = Number.isNaN(parsed) ? Date.now() : parsed;
            } else {
              timestampMs = Date.now();
            }
            const payload = this.parseEventPayload(row.EventPayload);

            // Construct event object matching Event interface structure
            // We first check the type is valid using satisfies, then cast to EventType
            // since EventType is a generic that could be a more specific subtype, but
            // we have already checked the type is valid using satisfies, so we can cast
            // to EventType. TypeScript just isn't as clever as we are. hehe.
            const event = {
              id: row.EventId,
              aggregateId: aggregateId,
              tenantId: createTenantId(context.tenantId),
              timestamp: timestampMs,
              type: row.EventType as EventType["type"],
              data: payload,
              metadata: {
                processingTraceparent: row.ProcessingTraceparent || void 0,
              },
            } satisfies Event;

            return event as EventType;
          });
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
        EventUtils.validateTenantId(
          context,
          "EventStoreClickHouse.storeEvents",
        );

        if (events.length === 0) {
          return;
        }

        // Validate all events before storage
        this.validateEvents(events, context);

        // Transform and store events
        await this.insertEvents(events, context, aggregateType);
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
  ): void {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event) {
        throw new Error(`[VALIDATION] Event at index ${i} is undefined`);
      }

      this.validateEventTenant(event, context, i);
      this.validateEventStructure(event, context, i);
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
      const error = new Error(
        `[SECURITY] Event at index ${index} has no tenantId`,
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
      const error = new Error(
        `[SECURITY] Event at index ${index} has tenantId '${String(eventTenantId)}' that does not match context tenantId '${context.tenantId}'`,
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
      const error = new Error(
        `[VALIDATION] Invalid event at index ${index}: event must have id, aggregateId, timestamp, type, and data`,
      );
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
      throw error;
    }
  }

  /**
   * Transforms events to ClickHouse format and inserts them.
   */
  private async insertEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<void> {
    try {
      const eventRecords = events.map(
        (event) =>
          ({
            TenantId: String(event.tenantId),
            AggregateType: aggregateType,
            AggregateId: String(event.aggregateId),
            EventId: event.id,
            EventTimestamp: event.timestamp,
            EventType: event.type,
            EventPayload: event.data ?? {},
            ProcessingTraceparent: event.metadata?.processingTraceparent ?? "",
          }) satisfies EventRecord,
      );

      await this.clickHouseClient.insert({
        table: "event_log",
        values: eventRecords,
        format: "JSONEachRow",
      });

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
          aggregateType,
          eventCount: events.length,
          aggregateIds: [...new Set(events.map((e) => String(e.aggregateId)))],
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
          errorName: error instanceof Error ? error.name : void 0,
        },
        "Failed to store events in ClickHouse",
      );
      throw error;
    }
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
      throw new Error(
        `[CORRUPTED_DATA] EventPayload is not a string or object, it is of type ${typeof rawPayload}`,
      );
    }
  }
}

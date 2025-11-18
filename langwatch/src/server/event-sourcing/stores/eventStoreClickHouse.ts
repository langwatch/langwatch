import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type {
  EventStore as BaseEventStore,
  EventStoreReadContext,
  EventStoreListCursor,
  ListAggregateIdsResult,
  Event,
  AggregateType,
} from "../library";
import { EventUtils, createTenantId } from "../library";
import { createLogger } from "../../../utils/logger";

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

export class EventStoreClickHouse<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> implements BaseEventStore<AggregateId, EventType>
{
  tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-store.clickhouse",
  );
  logger = createLogger("langwatch:trace-processing:event-store:clickhouse");

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getEvents(
    aggregateId: AggregateId,
    context: EventStoreReadContext<AggregateId, EventType>,
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

<<<<<<< Updated upstream
          return rows.map((row): EventType => {
            const timestampMs = Date.parse(row.EventTimestamp);
            const payload = row.EventPayload
              ? typeof row.EventPayload === "string"
                ? JSON.parse(row.EventPayload)
                : row.EventPayload
              : {};
=======
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
>>>>>>> Stashed changes

            // Construct event object matching Event interface structure
            // We first check the type is valid using satisfies, then cast to EventType
            // since EventType is a generic that could be a more specific subtype, but
            // we have already checked the type is valid using satisfies, so we can cast
            // to EventType. TypeScript just isn't as clever as we are. hehe.
            const event = {
              aggregateId: aggregateId,
              tenantId: createTenantId(context.tenantId),
              timestamp: timestampMs,
              type: row.EventType as EventType["type"],
              data: payload,
              metadata: {
                processingTraceparent: row.ProcessingTraceparent || void 0,
              },
            } satisfies Event<AggregateId>;

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
    context: EventStoreReadContext<AggregateId, EventType>,
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
        // Validate tenant context
        EventUtils.validateTenantId(
          context,
          "EventStoreClickHouse.storeEvents",
        );

        if (events.length === 0) {
          return;
        }

        // Validate all events before storage
        // Security checks (tenantId) should happen before validation checks
        for (let i = 0; i < events.length; i++) {
          const event = events[i];

          // First, check tenantId for security (before validation)
          const eventTenantId = event?.tenantId;
          if (!eventTenantId) {
            const error = new Error(
              `[SECURITY] Event at index ${i} has no tenantId`,
            );
            this.logger.error(
              {
                tenantId: context.tenantId,
                eventIndex: i,
                aggregateId: event?.aggregateId
                  ? String(event.aggregateId)
                  : "missing",
                eventType: event?.type ?? "missing",
              },
              "Event has no tenantId",
            );
            throw error;
          }

          if (eventTenantId !== context.tenantId) {
            const error = new Error(
              `[SECURITY] Event at index ${i} has tenantId '${String(eventTenantId)}' that does not match context tenantId '${context.tenantId}'`,
            );
            this.logger.error(
              {
                tenantId: context.tenantId,
                eventIndex: i,
                eventTenantId,
                aggregateId: event?.aggregateId
                  ? String(event.aggregateId)
                  : "missing",
              },
              "Tenant mismatch in event batch",
            );
            throw error;
          }

          // Then validate event structure
          if (!EventUtils.isValidEvent(event)) {
            const error = new Error(
              `[VALIDATION] Invalid event at index ${i}: event must have aggregateId, timestamp, type, and data`,
            );
            this.logger.error(
              {
                tenantId: context.tenantId,
                eventIndex: i,
                aggregateId: event?.aggregateId
                  ? String(event.aggregateId)
                  : "missing",
                eventType: event?.type ?? "missing",
              },
              "Invalid event rejected",
            );
            throw error;
          }
        }

        try {
          // Transform events to ClickHouse format
<<<<<<< Updated upstream
          const eventRecords = events.map((event) => ({
            TenantId: context.tenantId,
            AggregateType: aggregateType,
            AggregateId: event.aggregateId,
            EventId: this.generateEventId(),
            EventTimestamp: event.timestamp,
            EventType: event.type,
            EventPayload: JSON.stringify(event.data),
            ProcessingTraceparent:
              (event.metadata as { processingTraceparent?: string })
                ?.processingTraceparent ?? "",
          }));
=======
          // For Object type columns with JSONEachRow, pass as JavaScript objects
          // The ClickHouse client will handle serialization automatically
          const eventRecords = events.map(
            (event) =>
              ({
                TenantId: String(event.tenantId),
                AggregateType: aggregateType,
                AggregateId: String(event.aggregateId),
                EventId: this.generateEventId(),
                EventTimestamp: event.timestamp,
                EventType: event.type,
                EventPayload: event.data ?? {},
                ProcessingTraceparent:
                  event.metadata?.processingTraceparent ?? "",
              }) satisfies EventRecord,
          );
>>>>>>> Stashed changes

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

  private generateEventId(): string {
<<<<<<< Updated upstream
    // Generate a UUID v4 for the event
    // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // where y is one of 8, 9, a, or b
    const randomHex = (length: number): string => {
      return Array.from({ length }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("");
    };

    // Fourth segment must start with 8, 9, a, or b (variant bits)
    const variantChar = ["8", "9", "a", "b"][Math.floor(Math.random() * 4)];

    return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${variantChar}${randomHex(3)}-${randomHex(12)}`;
=======
    // Generate a KSUID for the event!!
    // KSUIDs are k-sortable, providing better ordering guarantees than UUIDs
    // when used as a secondary sort key (EventTimestamp ASC, EventId ASC)
    return generate("event").toString();
>>>>>>> Stashed changes
  }

  async listAggregateIds(
    context: EventStoreReadContext<AggregateId, EventType>,
    aggregateType: AggregateType,
    cursor?: EventStoreListCursor,
    limit = 100,
  ): Promise<ListAggregateIdsResult<AggregateId>> {
    return await this.tracer.withActiveSpan(
      "EventStoreClickHouse.listAggregateIds",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": context.tenantId,
          "aggregate.type": aggregateType,
          cursor: cursor ? String(cursor) : "none",
          limit: limit,
        },
      },
      async () => {
        // Validate tenant context
        EventUtils.validateTenantId(
          context,
          "EventStoreClickHouse.listAggregateIds",
        );

        try {
          // Use cursor for pagination (cursor is the last aggregateId seen)
          const cursorValue =
            typeof cursor === "string" && cursor.length > 0 ? cursor : "";
          const cursorCondition = cursorValue
            ? `AND AggregateId > {cursor:String}`
            : "";

          const result = await this.clickHouseClient.query({
            query: `
              SELECT DISTINCT AggregateId
              FROM event_log
              WHERE TenantId = {tenantId:String}
                AND AggregateType = {aggregateType:String}
                ${cursorCondition}
              ORDER BY AggregateId ASC
              LIMIT {limit:UInt32}
            `,
            query_params: {
              tenantId: context.tenantId,
              aggregateType,
              cursor: cursorValue,
              limit,
            },
            format: "JSONEachRow",
          });

          const rows: Array<{ AggregateId: string }> = await result.json();
          const aggregateIds = rows.map(
            (row) => row.AggregateId as AggregateId,
          );

          // If we got exactly 'limit' results, there might be more
          const nextCursor: EventStoreListCursor | undefined =
            aggregateIds.length === limit
              ? (aggregateIds[aggregateIds.length - 1] as EventStoreListCursor)
              : void 0;

          this.logger.debug(
            {
              tenantId: context.tenantId,
              cursor: cursor ?? "none",
              returned: aggregateIds.length,
              nextCursor: nextCursor ?? "none",
            },
            "Listed aggregate IDs",
          );

          return {
            aggregateIds,
            nextCursor,
          };
        } catch (error) {
          this.logger.error(
            {
              tenantId: context.tenantId,
              aggregateType,
              cursor: cursor ?? "none",
              limit,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
              errorName: error instanceof Error ? error.name : void 0,
            },
            "Failed to list aggregate IDs from ClickHouse",
          );
          throw error;
        }
      },
    );
  }
}

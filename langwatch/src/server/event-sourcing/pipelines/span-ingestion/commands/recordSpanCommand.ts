import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { Command, CommandHandler } from "../../../library";
import { EventUtils, createTenantId } from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { StoreSpanIngestionCommandData } from "../schemas/commands";
import { SPAN_INGESTION_RECORD_COMMAND_TYPE, storeSpanIngestionCommandDataSchema } from "../schemas/commands";
import type { SpanIngestionRecordedEvent } from "../schemas/events";
import { SPAN_INGESTION_RECORDED_EVENT_TYPE } from "../schemas/events";
import { createLogger } from "../../../../../utils/logger";
import { getClickHouseClient } from "../../../../../utils/clickhouse";
import { SpanRepositoryClickHouse } from "../repositories/spanRepositoryClickHouse";
import { SpanRepositoryMemory } from "../repositories/spanRepositoryMemory";
import type { SpanRepository } from "../repositories/spanRepository";

/**
 * Self-contained command handler for span ingestion record commands.
 * Bundles schema, handler implementation, and configuration methods.
 * Writes span data to ClickHouse and returns a lightweight span ingestion event.
 * Event handlers will react to this event to perform side effects (e.g., trigger trace processing).
 */
export class RecordSpanCommand
  implements
    CommandHandler<
      Command<StoreSpanIngestionCommandData>,
      SpanIngestionRecordedEvent
    >
{
  static readonly schema = defineCommandSchema(
    SPAN_INGESTION_RECORD_COMMAND_TYPE,
    storeSpanIngestionCommandDataSchema,
    "Command to record a span ingestion event",
  );

  tracer = getLangWatchTracer(
    "langwatch.span-ingestion-record.command-handler",
  );
  logger = createLogger("langwatch:span-ingestion-record:command-handler");
  private readonly spanRepository: SpanRepository;

  constructor() {
    // Initialize repository (same pattern as pipeline.ts)
    const clickHouseClient = getClickHouseClient();
    this.spanRepository = clickHouseClient
      ? new SpanRepositoryClickHouse(clickHouseClient)
      : new SpanRepositoryMemory();
  }

  async handle(
    command: Command<StoreSpanIngestionCommandData>,
  ): Promise<SpanIngestionRecordedEvent[]> {
    return await this.tracer.withActiveSpan(
      "SpanIngestionRecordCommandHandler.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": command.aggregateId,
          "tenant.id": command.tenantId,
        },
      },
      async () => {
        const commandData = command.data;
        const { spanData, collectedAtUnixMs } = commandData;
        const tenantId = createTenantId(command.tenantId);
        const traceId = spanData.traceId;
        const spanId = spanData.spanId;

        this.logger.info(
          {
            tenantId,
            traceId,
            spanId,
            collectedAtUnixMs,
          },
          "Handling span ingestion record command",
        );

        // Write span data to ClickHouse (infrastructure side effect)
        // This ensures span data is available for event handlers that need it
        await this.spanRepository.insertSpan(commandData);

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
          },
          "Span data written to ClickHouse",
        );

        // Create lightweight event with only identifiers
        // Full span data is stored separately in ClickHouse
        const ingestionEvent = EventUtils.createEvent<SpanIngestionRecordedEvent>(
          "span_ingestion",
          traceId,
          tenantId,
          SPAN_INGESTION_RECORDED_EVENT_TYPE,
          {
            traceId,
            spanId,
            collectedAtUnixMs,
          },
          {
            spanId,
            collectedAtUnixMs,
          },
        );

        return [ingestionEvent];
      },
    );
  }

  static getAggregateId(payload: StoreSpanIngestionCommandData): string {
    return payload.spanData.traceId;
  }

  static getSpanAttributes(
    payload: StoreSpanIngestionCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.spanData.traceId,
      "payload.span.id": payload.spanData.spanId,
    };
  }

  static makeJobId(payload: StoreSpanIngestionCommandData): string {
    return `${payload.tenantId}:${payload.spanData.traceId}:${payload.spanData.spanId}`;
  }
}

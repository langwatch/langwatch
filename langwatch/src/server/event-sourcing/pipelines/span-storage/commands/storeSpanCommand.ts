import { generate } from "@langwatch/ksuid";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { Command, CommandHandler } from "../../../library";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../library";
import type { StoreSpanCommandData } from "../schemas/commands";
import {
  STORE_SPAN_COMMAND_TYPE,
  storeSpanCommandDataSchema,
} from "../schemas/commands";
import type { SpanStoredEvent } from "../schemas/events";
import { SPAN_STORED_EVENT_TYPE } from "../schemas/events";

/**
 * Command handler for storing spans in the span storage pipeline.
 * Maps incoming span data and emits a SpanStoredEvent.
 *
 * @example
 * ```typescript
 * await spanStoragePipeline.commands.storeSpan.send({
 *   tenantId: "tenant_123",
 *   spanData: { ... },
 *   collectedAtUnixMs: Date.now(),
 * });
 * ```
 */
export class StoreSpanCommand
  implements CommandHandler<Command<StoreSpanCommandData>, SpanStoredEvent>
{
  static readonly schema = defineCommandSchema(
    STORE_SPAN_COMMAND_TYPE,
    storeSpanCommandDataSchema,
    "Command to store a span in the span storage pipeline",
  );

  tracer = getLangWatchTracer("langwatch.span-storage.store-span");
  logger = createLogger("langwatch:span-storage:store-span");

  async handle(
    command: Command<StoreSpanCommandData>,
  ): Promise<SpanStoredEvent[]> {
    return await this.tracer.withActiveSpan(
      "StoreSpanCommand.handle",
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

        // Generate span record id for the event
        const spanRecordId = generate("span").toString();

        this.logger.info(
          {
            tenantId,
            traceId,
            spanId,
            collectedAtUnixMs,
            spanRecordId,
          },
          "Handling store span command",
        );

        // Create complete span data with id and tenantId
        const completeSpanData = {
          ...spanData,
          id: spanRecordId,
          tenantId: command.tenantId,
        };

        // Emit event with full span data
        // Aggregate ID is spanId for span-level aggregates
        const spanStoredEvent = EventUtils.createEvent<SpanStoredEvent>(
          "span",
          spanId, // aggregateId is spanId, not traceId
          tenantId,
          SPAN_STORED_EVENT_TYPE,
          {
            spanData: completeSpanData,
            collectedAtUnixMs,
          },
          {
            traceId,
            collectedAtUnixMs,
          },
        );

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
            eventId: spanStoredEvent.id,
          },
          "Emitting SpanStoredEvent",
        );

        return [spanStoredEvent];
      },
    );
  }

  static getAggregateId(payload: StoreSpanCommandData): string {
    // Span-level aggregate: aggregateId is spanId
    return payload.spanData.spanId;
  }

  static getSpanAttributes(
    payload: StoreSpanCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.spanData.traceId,
      "payload.span.id": payload.spanData.spanId,
    };
  }

  static makeJobId(payload: StoreSpanCommandData): string {
    return `${payload.tenantId}:${payload.spanData.spanId}`;
  }
}


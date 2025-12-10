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
import type { RecordSpanCommandData } from "../schemas/commands";
import {
  RECORD_SPAN_COMMAND_TYPE,
  recordSpanCommandDataSchema,
} from "../schemas/commands";
import type { SpanReceivedEvent } from "../schemas/events";
import { SPAN_RECEIVED_EVENT_TYPE } from "../schemas/events";

/**
 * Command handler for recording spans in the trace processing pipeline.
 * Maps incoming span data and emits a SpanReceivedEvent with full span data.
 *
 * Storage to ClickHouse is handled by the SpanStorageProjection, not this command.
 * This ensures events contain all data needed for replay.
 *
 * @example
 * ```typescript
 * await traceProcessingPipeline.commands.recordSpan.send({
 *   tenantId: "tenant_123",
 *   spanData: { ... },
 *   collectedAtUnixMs: Date.now(),
 * });
 * ```
 */
export class RecordSpanCommand
  implements CommandHandler<Command<RecordSpanCommandData>, SpanReceivedEvent>
{
  static readonly schema = defineCommandSchema(
    RECORD_SPAN_COMMAND_TYPE,
    recordSpanCommandDataSchema,
    "Command to record a span in the trace processing pipeline",
  );

  tracer = getLangWatchTracer("langwatch.trace-processing.record-span");
  logger = createLogger("langwatch:trace-processing:record-span");

  async handle(
    command: Command<RecordSpanCommandData>,
  ): Promise<SpanReceivedEvent[]> {
    return await this.tracer.withActiveSpan(
      "RecordSpanCommand.handle",
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
          "Handling record span command",
        );

        // Create complete span data with id and tenantId for event storage
        const completeSpanData = {
          ...spanData,
          id: spanRecordId,
          tenantId: command.tenantId,
        };

        // Emit event with full span data
        // SpanStorageProjection will handle writing to ClickHouse
        // TraceSummaryProjection will handle aggregation
        const spanReceivedEvent = EventUtils.createEvent<SpanReceivedEvent>(
          "trace",
          traceId,
          tenantId,
          SPAN_RECEIVED_EVENT_TYPE,
          {
            spanData: completeSpanData,
            collectedAtUnixMs,
          },
          {
            spanId,
            collectedAtUnixMs,
          },
        );

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
            eventId: spanReceivedEvent.id,
          },
          "Emitting SpanReceivedEvent",
        );

        return [spanReceivedEvent];
      },
    );
  }

  static getAggregateId(payload: RecordSpanCommandData): string {
    return payload.spanData.traceId;
  }

  static getSpanAttributes(
    payload: RecordSpanCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.spanData.traceId,
      "payload.span.id": payload.spanData.spanId,
    };
  }

  static makeJobId(payload: RecordSpanCommandData): string {
    return `${payload.tenantId}:${payload.spanData.traceId}:${payload.spanData.spanId}`;
  }
}

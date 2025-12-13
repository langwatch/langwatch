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
 * Emits a SpanReceivedEvent with pure span data (user input only).
 *
 * Events store only pure data without computed fields (id, aggregateId, tenantId).
 * This enables proper event sourcing where events can be replayed with different
 * processing logic. Event handlers enrich the data with computed fields as needed.
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

  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.record-span",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:record-span",
  );

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

        this.logger.info(
          {
            tenantId,
            traceId,
            spanId,
            collectedAtUnixMs,
          },
          "Handling record span command",
        );

        // Emit event with pure span data (no computed fields)
        // Event handlers will enrich with id, aggregateId, tenantId during processing
        const spanReceivedEvent = EventUtils.createEvent<SpanReceivedEvent>(
          "trace",
          traceId,
          tenantId,
          SPAN_RECEIVED_EVENT_TYPE,
          {
            spanData,
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

import crypto from "node:crypto";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import {
  recordLogCommandDataSchema,
  type RecordLogCommandData,
} from "../schemas/commands";
import {
  RECORD_LOG_COMMAND_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { LogRecordReceivedEvent } from "../schemas/events";

export class RecordLogCommand
  implements CommandHandler<Command<RecordLogCommandData>, LogRecordReceivedEvent>
{
  static readonly schema = defineCommandSchema(
    RECORD_LOG_COMMAND_TYPE,
    recordLogCommandDataSchema,
    "Command to record a log record in the trace processing pipeline",
  );

  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.record-log",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:record-log",
  );

  async handle(
    command: Command<RecordLogCommandData>,
  ): Promise<LogRecordReceivedEvent[]> {
    return await this.tracer.withActiveSpan(
      "RecordLogCommand.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": command.aggregateId,
          "tenant.id": command.tenantId,
        },
      },
      async () => {
        const { tenantId: tenantIdStr, data: commandData } = command;
        const tenantId = createTenantId(tenantIdStr);

        this.logger.info(
          {
            tenantId,
            traceId: commandData.traceId,
            spanId: commandData.spanId,
          },
          "Handling record log command",
        );

        const event = EventUtils.createEvent<LogRecordReceivedEvent>({
          aggregateType: "trace",
          aggregateId: commandData.traceId,
          tenantId,
          type: LOG_RECORD_RECEIVED_EVENT_TYPE,
          version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
          data: {
            traceId: commandData.traceId,
            spanId: commandData.spanId,
            timeUnixMs: commandData.timeUnixMs,
            severityNumber: commandData.severityNumber,
            severityText: commandData.severityText,
            body: commandData.body,
            attributes: commandData.attributes,
            resourceAttributes: commandData.resourceAttributes,
            scopeName: commandData.scopeName,
            scopeVersion: commandData.scopeVersion,
          },
          metadata: {},
          occurredAt: commandData.occurredAt,
          idempotencyKey: RecordLogCommand.makeJobId(commandData),
        });

        return [event];
      },
    );
  }

  static getAggregateId(payload: RecordLogCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: RecordLogCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.span.id": payload.spanId,
    };
  }

  static makeJobId(payload: RecordLogCommandData): string {
    const contentHash = crypto
      .createHash("sha256")
      .update(payload.body)
      .digest("hex")
      .slice(0, 16);
    return `${payload.tenantId}:${payload.traceId}:${payload.spanId}:log:${payload.timeUnixMs}:${payload.severityNumber}:${payload.scopeName}:${contentHash}`;
  }
}

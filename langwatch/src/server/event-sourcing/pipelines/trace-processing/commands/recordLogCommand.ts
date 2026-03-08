import crypto from "node:crypto";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { OtlpSpanPiiRedactionService } from "~/server/app-layer/traces/span-pii-redaction.service";
import { createLogger } from "../../../../../utils/logger/server";
import type { Command, CommandHandler } from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type PIIRedactionLevel,
  type RecordLogCommandData,
  recordLogCommandDataSchema,
} from "../schemas/commands";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  RECORD_LOG_COMMAND_TYPE,
} from "../schemas/constants";
import type { LogRecordReceivedEvent } from "../schemas/events";

/**
 * Dependencies for RecordLogCommand that can be injected for testing.
 */
export interface RecordLogCommandDependencies {
  /** Service for redacting PII from logs. */
  piiRedactionService: {
    redactLog: (
      log: { body: string; attributes: Record<string, string> },
      piiRedactionLevel: PIIRedactionLevel,
    ) => Promise<void>;
  };
}

function createDefaultDependencies(): RecordLogCommandDependencies {
  return {
    piiRedactionService: OtlpSpanPiiRedactionService.create(),
  };
}

export class RecordLogCommand
  implements
    CommandHandler<Command<RecordLogCommandData>, LogRecordReceivedEvent>
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
  private readonly deps: RecordLogCommandDependencies;

  constructor(deps?: RecordLogCommandDependencies) {
    this.deps = deps ?? createDefaultDependencies();
  }

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

        const piiRedactionLevel =
          commandData.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL;

        // Clone body and attributes before mutation
        const logToRedact = {
          body: commandData.body,
          attributes: { ...commandData.attributes },
        };

        try {
          await this.deps.piiRedactionService.redactLog(
            logToRedact,
            piiRedactionLevel,
          );
        } catch (error) {
          this.logger.error(
            { error, tenantId, traceId: commandData.traceId },
            "PII redaction failed for log, aborting to prevent leak",
          );
          throw error;
        }

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
            body: logToRedact.body,
            attributes: logToRedact.attributes,
            resourceAttributes: commandData.resourceAttributes,
            scopeName: commandData.scopeName,
            scopeVersion: commandData.scopeVersion,
            piiRedactionLevel,
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
    const attributesHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(Object.entries(payload.attributes).sort()))
      .update(JSON.stringify(Object.entries(payload.resourceAttributes).sort()))
      .digest("hex")
      .slice(0, 8);
    const contentHash = crypto
      .createHash("sha256")
      .update(payload.body)
      .digest("hex")
      .slice(0, 16);
    return `${payload.tenantId}:${payload.traceId}:${payload.spanId}:log:${payload.timeUnixMs}:${payload.severityNumber}:${payload.scopeName}:${payload.scopeVersion}:${attributesHash}:${contentHash}`;
  }
}

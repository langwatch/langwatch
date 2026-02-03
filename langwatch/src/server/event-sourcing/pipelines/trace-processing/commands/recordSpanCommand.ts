import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { Command, CommandHandler } from "../../../library";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../library";
import type { OtlpSpan } from "../schemas/otlp";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  recordSpanCommandDataSchema,
  type PIIRedactionLevel,
  type RecordSpanCommandData,
} from "../schemas/commands";
import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { SpanReceivedEvent } from "../schemas/events";
import { OtlpSpanPiiRedactionService } from "../services/otlpSpanPiiRedactionService";
import { TraceRequestUtils } from "../utils/traceRequest.utils";

/**
 * Dependencies for RecordSpanCommand that can be injected for testing.
 */
export interface RecordSpanCommandDependencies {
  /** Service for redacting PII from spans. */
  piiRedactionService: {
    redactSpan: (span: OtlpSpan, piiRedactionLevel: PIIRedactionLevel) => Promise<void>;
  };
}

/** Cached default dependencies, lazily initialized */
let cachedDefaultDependencies: RecordSpanCommandDependencies | null = null;

function getDefaultDependencies(): RecordSpanCommandDependencies {
  if (!cachedDefaultDependencies) {
    cachedDefaultDependencies = {
      piiRedactionService: new OtlpSpanPiiRedactionService(),
    };
  }
  return cachedDefaultDependencies;
}

/**
 * Command handler for recording spans in the trace processing pipeline.
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
  private readonly deps: RecordSpanCommandDependencies;

  constructor(deps: Partial<RecordSpanCommandDependencies> = {}) {
    this.deps = { ...getDefaultDependencies(), ...deps };
  }

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
        const { tenantId: tenantIdStr, data: commandData } = command;
        const tenantId = createTenantId(tenantIdStr);
        const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
          commandData.span,
        );

        this.logger.info(
          {
            tenantId,
            traceId,
            spanId,
          },
          "Handling record span command",
        );

        // Clone span before redaction to preserve command immutability
        const spanToRedact = structuredClone(commandData.span);
        const piiRedactionLevel =
          commandData.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL;
        await this.deps.piiRedactionService.redactSpan(
          spanToRedact,
          piiRedactionLevel,
        );

        const spanReceivedEvent = EventUtils.createEvent<SpanReceivedEvent>(
          "trace",
          traceId,
          tenantId,
          SPAN_RECEIVED_EVENT_TYPE,
          SPAN_RECEIVED_EVENT_VERSION_LATEST,
          {
            span: spanToRedact,
            resource: commandData.resource,
            instrumentationScope: commandData.instrumentationScope,
            piiRedactionLevel,
          },
          { traceId, spanId },
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
    return TraceRequestUtils.normalizeOtlpId(payload.span.traceId);
  }

  static getSpanAttributes(
    payload: RecordSpanCommandData,
  ): Record<string, string | number | boolean> {
    const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
      payload.span,
    );

    return {
      "payload.trace.id": traceId,
      "payload.span.id": spanId,
    };
  }

  static makeJobId(payload: RecordSpanCommandData): string {
    const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
      payload.span,
    );

    return `${payload.tenantId}:${traceId}:${spanId}`;
  }
}

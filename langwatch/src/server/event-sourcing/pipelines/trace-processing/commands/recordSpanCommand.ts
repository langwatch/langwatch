import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger/server";
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
import { OtlpSpanCostEnrichmentService } from "../services/otlpSpanCostEnrichmentService";
import { OtlpSpanPiiRedactionService } from "../services/otlpSpanPiiRedactionService";
import { TraceRequestUtils } from "../utils/traceRequest.utils";

/**
 * Dependencies for RecordSpanCommand that can be injected for testing.
 */
export interface RecordSpanCommandDependencies {
  /** Service for redacting PII from spans. */
  piiRedactionService: {
    redactSpan: (
      span: OtlpSpan,
      piiRedactionLevel: PIIRedactionLevel,
    ) => Promise<void>;
  };
  /** Service for enriching spans with custom LLM cost rates. */
  costEnrichmentService: {
    enrichSpan: (span: OtlpSpan, tenantId: string) => Promise<void>;
  };
}

/** Cached default dependencies, lazily initialized */
let cachedDefaultDependencies: RecordSpanCommandDependencies | null = null;

function getDefaultDependencies(): RecordSpanCommandDependencies {
  if (!cachedDefaultDependencies) {
    cachedDefaultDependencies = {
      piiRedactionService: new OtlpSpanPiiRedactionService(),
      costEnrichmentService: new OtlpSpanCostEnrichmentService(),
    };
  }
  return cachedDefaultDependencies;
}

/**
 * Command handler for recording spans in the trace processing pipeline.
 */
export class RecordSpanCommand implements CommandHandler<
  Command<RecordSpanCommandData>,
  SpanReceivedEvent
> {
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

        // Clone span before mutation to preserve command immutability
        const spanToProcess = structuredClone(commandData.span);
        const piiRedactionLevel =
          commandData.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL;

        // Run PII redaction and cost enrichment in parallel.
        // Safe: PII modifies existing attr values; cost pushes new entries.
        const results = await Promise.allSettled([
          this.deps.piiRedactionService.redactSpan(
            spanToProcess,
            piiRedactionLevel,
          ),
          this.deps.costEnrichmentService.enrichSpan(
            spanToProcess,
            tenantIdStr,
          ),
        ]);

        for (const result of results) {
          if (result.status === "rejected") {
            this.logger.warn(
              { error: result.reason },
              "Span pre-processing step failed",
            );
          }
        }

        const spanReceivedEvent = EventUtils.createEvent<SpanReceivedEvent>(
          "trace",
          traceId,
          tenantId,
          SPAN_RECEIVED_EVENT_TYPE,
          SPAN_RECEIVED_EVENT_VERSION_LATEST,
          {
            span: spanToProcess,
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

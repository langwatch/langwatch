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
import type { OtlpSpan } from "../schemas/otlp";
import { OtlpSpanCostEnrichmentService } from "~/server/app-layer/traces/span-cost-enrichment.service";
import { OtlpSpanPiiRedactionService } from "~/server/app-layer/traces/span-pii-redaction.service";
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

        // Strip any user-submitted langwatch.reserved.* attributes — this domain
        // is reserved for system-generated attributes only.
        RecordSpanCommand.stripReservedAttributes(
          spanToProcess,
          this.logger,
        );

        const piiRedactionLevel =
          commandData.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL;

        // Run PII redaction and cost enrichment in parallel.
        // Safe: PII modifies existing attr values; cost pushes new entries.
        const [piiResult, costResult] = await Promise.allSettled([
          this.deps.piiRedactionService.redactSpan(
            spanToProcess,
            piiRedactionLevel,
          ),
          this.deps.costEnrichmentService.enrichSpan(
            spanToProcess,
            tenantIdStr,
          ),
        ]);

        // Cost enrichment is non-critical — log and continue
        if (costResult.status === "rejected") {
          this.logger.warn(
            { error: costResult.reason },
            "Cost enrichment failed, continuing without cost data",
          );
        }

        // PII redaction is critical — unredacted spans must not be emitted
        if (piiResult.status === "rejected") {
          this.logger.error(
            { error: piiResult.reason },
            "PII redaction failed, aborting span processing to prevent PII leak",
          );
          throw piiResult.reason instanceof Error
            ? piiResult.reason
            : new Error(String(piiResult.reason));
        }

        const spanReceivedEvent = EventUtils.createEvent<SpanReceivedEvent>({
          aggregateType: "trace",
          aggregateId: traceId,
          tenantId,
          type: SPAN_RECEIVED_EVENT_TYPE,
          version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          data: {
            span: spanToProcess,
            resource: commandData.resource,
            instrumentationScope: commandData.instrumentationScope,
            piiRedactionLevel,
          },
          metadata: { traceId, spanId },
          occurredAt: commandData.occurredAt,
        });

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

  /**
   * Strips any `langwatch.reserved.*` attributes from a span and its events/links.
   * These attributes are reserved for system use and must not be set by users.
   */
  private static stripReservedAttributes(
    span: OtlpSpan,
    logger: ReturnType<typeof createLogger>,
  ): void {
    const RESERVED_PREFIX = "langwatch.reserved.";

    const strip = (attributes: OtlpSpan["attributes"]): OtlpSpan["attributes"] => {
      const filtered = attributes.filter((attr) => {
        if (attr.key.startsWith(RESERVED_PREFIX)) {
          logger.error(
            { attributeKey: attr.key },
            "Stripped user-submitted langwatch.reserved.* attribute",
          );
          return false;
        }
        return true;
      });
      return filtered;
    };

    span.attributes = strip(span.attributes);
    for (const event of span.events) {
      event.attributes = strip(event.attributes);
    }
    for (const link of span.links) {
      link.attributes = strip(link.attributes);
    }
  }

  static makeJobId(payload: RecordSpanCommandData): string {
    const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
      payload.span,
    );

    return `${payload.tenantId}:${traceId}:${spanId}`;
  }
}

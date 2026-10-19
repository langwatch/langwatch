import {
  type Command,
  type CommandHandler,
  createTenantId,
  defineCommandSchema,
  EventUtils,
  type TenantId,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  instrumentationScopeSchema,
  resourceSchema,
  spanSchema,
  type OtlpResource,
  type OtlpSpan,
} from "@langwatch/otlp/trace-request";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  RECORD_SPAN_COMMAND_TYPE,
  recordSpanCommandDataSchema,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  type RecordSpanCommandData,
  type SpanReceivedEvent,
  type PIIRedactionLevel,
  TRUNCATED_ATTRIBUTES_KEY,
} from "@langwatch/trace-contract";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { z } from "zod";

import { clonePayload } from "../rules/payload-clone.rules.ts";
import {
  capOversizedAttributes,
  MAX_RECORDED_ATTRIBUTE_VALUE_BYTES,
} from "../rules/trace-attribute-cap.rules.ts";

export interface TraceSpanPiiRedaction {
  redact(input: {
    span: OtlpSpan;
    resource: OtlpResource | null;
    piiRedactionLevel: PIIRedactionLevel;
    tenantId: TenantId;
  }): Promise<void>;
}

export interface TraceSpanCostEnrichment {
  enrich(span: OtlpSpan, tenantId: string): Promise<void>;
}

export interface TraceSpanTokenEstimation {
  estimate(span: OtlpSpan, tenantId: string): Promise<void>;
}

type TraceSpanContentDropResult = {
  droppedCount: number;
  droppedCategories: string[];
};

export interface TraceSpanContentDrop {
  drop(span: OtlpSpan, projectId: string): Promise<TraceSpanContentDropResult>;
}

export type TraceSpanSpoolIdentity = {
  spoolRef: string;
  projectId: string;
  traceId: string;
  spanId: string;
};

/** Transient oversized-command storage. The event log remains authoritative. */
export interface TraceSpanSpool {
  read(identity: TraceSpanSpoolIdentity): Promise<string>;
  delete(identity: TraceSpanSpoolIdentity): Promise<void>;
}

const spooledRecordSpanSchema = z.object({
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
});

/**
 * Error names the spool's storage raises for an empty address: the stored-object byte layer
 * (`StoredObjectNotFoundError`, `ObjectNotFoundError`) and S3's `NoSuchKey` on the v1 path.
 * Matched by name, since the error crosses the adapter that implements the spool port.
 */
const MISSING_SPOOL_OBJECT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "StoredObjectNotFoundError",
  "ObjectNotFoundError",
  "NoSuchKey",
]);

function isMissingSpoolObject(error: unknown): boolean {
  return error instanceof Error && MISSING_SPOOL_OBJECT_ERROR_NAMES.has(error.name);
}

export const RECORD_SPAN_DEDUPLICATION = {
  makeId: (payload: RecordSpanCommandData) =>
    `${payload.tenantId}:${payload.span.traceId}:${payload.span.spanId}`,
  ttlMs: 30_000,
  extend: true,
  replace: true,
} as const;

export type RecordSpanCommandOptions = {
  piiRedaction: TraceSpanPiiRedaction;
  costEnrichment: TraceSpanCostEnrichment;
  tokenEstimation: TraceSpanTokenEstimation;
  contentDrop: TraceSpanContentDrop;
  spool?: TraceSpanSpool;
};

/** Turns one prepared raw span into Trace's one durable aggregate event. */
export class EventingRecordSpanAdapter implements CommandHandler<
  Command<RecordSpanCommandData>,
  SpanReceivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SPAN_COMMAND_TYPE,
    recordSpanCommandDataSchema,
    "Command to record a span in the trace processing pipeline",
  );

  private static readonly RESERVED_ATTRIBUTE_PREFIX = "langwatch.reserved.";
  private static readonly RESERVED_ATTRIBUTE_PASSTHROUGH = new Set([
    "langwatch.reserved.causality_depth",
    "langwatch.reserved.skip_token_accumulation",
  ]);

  private readonly tracer = getLangWatchTracer("langwatch.trace-processing.record-span");
  private readonly logger = createLogger("langwatch:trace-processing:record-span");

  private constructor(private readonly options: RecordSpanCommandOptions) {}

  static create(options: RecordSpanCommandOptions): EventingRecordSpanAdapter {
    return new EventingRecordSpanAdapter(options);
  }

  async handle(command: Command<RecordSpanCommandData>): Promise<SpanReceivedEvent[]> {
    return this.tracer.withActiveSpan(
      "EventingRecordSpanAdapter.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": command.aggregateId,
          "tenant.id": command.tenantId,
        },
      },
      async () => this.record(command),
    );
  }

  async cleanupAfterStore(command: Command<RecordSpanCommandData>): Promise<void> {
    const spoolRef = command.data.spoolRef;
    if (!spoolRef || !this.options.spool) {
      return;
    }

    await this.options.spool
      .delete({
        spoolRef,
        projectId: command.tenantId,
        traceId: command.data.span.traceId,
        spanId: command.data.span.spanId,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          {
            spoolRef,
            error: error instanceof Error ? error.message : String(error),
          },
          "Best-effort spool deletion failed; lifecycle policy will clean up",
        );
      });
  }

  static getAggregateId(payload: RecordSpanCommandData): string {
    return payload.span.traceId;
  }

  static getSpanAttributes(
    payload: RecordSpanCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.span.traceId,
      "payload.span.id": payload.span.spanId,
    };
  }

  static makeJobId(payload: RecordSpanCommandData): string {
    return `${payload.tenantId}:${payload.span.traceId}:${payload.span.spanId}`;
  }

  private async record(command: Command<RecordSpanCommandData>): Promise<SpanReceivedEvent[]> {
    const tenantId = createTenantId(command.tenantId);
    const commandData = await this.resolveCommandData(command);
    if (!commandData) return [];
    const traceId = commandData.span.traceId;
    const spanId = commandData.span.spanId;

    this.logger.debug({ tenantId, traceId, spanId }, "Handling record span command");

    const span = clonePayload(commandData.span);
    const resource = commandData.resource ? clonePayload(commandData.resource) : null;

    this.stripReservedAttributes(span, resource);
    this.capAttributes({ span, resource, tenantId, traceId, spanId });

    const piiRedactionLevel = commandData.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL;
    const [piiResult, costResult, tokenResult] = await Promise.allSettled([
      this.options.piiRedaction.redact({ span, resource, piiRedactionLevel, tenantId }),
      this.options.costEnrichment.enrich(span, command.tenantId),
      this.options.tokenEstimation.estimate(span, command.tenantId),
    ]);

    this.reportNonCriticalFailure(
      costResult,
      "Cost enrichment failed, continuing without cost data",
    );
    this.reportNonCriticalFailure(
      tokenResult,
      "Token estimation failed, continuing without estimated tokens",
    );
    if (piiResult.status === "rejected") {
      this.logger.error(
        { error: piiResult.reason },
        "PII redaction failed, aborting span processing to prevent PII leak",
      );
      throw piiResult.reason instanceof Error
        ? piiResult.reason
        : new Error(String(piiResult.reason));
    }

    const dropResult = await this.options.contentDrop.drop(span, command.tenantId);
    if (dropResult.droppedCount > 0) {
      this.logger.debug(
        {
          tenantId,
          traceId,
          spanId,
          droppedCount: dropResult.droppedCount,
          droppedCategories: dropResult.droppedCategories,
        },
        "Dropped span content per data-privacy policy",
      );
    }

    const spanReceivedEvent = EventUtils.createEvent<SpanReceivedEvent>({
      aggregateType: "trace",
      aggregateId: traceId,
      tenantId,
      type: SPAN_RECEIVED_EVENT_TYPE,
      version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
      data: {
        span,
        resource,
        instrumentationScope: commandData.instrumentationScope,
        piiRedactionLevel,
      },
      metadata: { traceId, spanId },
      occurredAt: commandData.occurredAt,
      idempotencyKey: `${command.tenantId}:${traceId}:${spanId}`,
    });

    this.logger.debug(
      {
        tenantId,
        traceId,
        spanId,
        spanReceivedEventId: spanReceivedEvent.id,
      },
      "Emitting the durable raw span event",
    );

    return [spanReceivedEvent];
  }

  /**
   * The command with its spooled span read back, or null when the spool object is gone
   * (deleted once the event is stored, or expired). No retry can rebuild it, so the command
   * completes with nothing to record instead of landing in the dead letters.
   */
  private async resolveCommandData(
    command: Command<RecordSpanCommandData>,
  ): Promise<RecordSpanCommandData | null> {
    const spoolRef = command.data.spoolRef;
    if (!spoolRef) {
      return command.data;
    }
    if (!this.options.spool) {
      throw new Error(
        `ADR-022: command carries spoolRef "${spoolRef}" but this handler has no blobStore configured to reconstitute the span. Refusing to emit a span with cleared attributes (would be permanent data loss in event_log).`,
      );
    }

    const identity = {
      spoolRef,
      projectId: command.tenantId,
      traceId: command.data.span.traceId,
      spanId: command.data.span.spanId,
    };
    let serialized: string;
    try {
      serialized = await this.options.spool.read(identity);
    } catch (error) {
      if (!isMissingSpoolObject(error)) throw error;
      this.logger.warn(
        { ...identity, errorName: (error as Error).name },
        "Spooled span object is gone; recording nothing (a redelivery after the span was stored, or an object that expired before the worker read it)",
      );
      return null;
    }
    const spooled = spooledRecordSpanSchema.parse(JSON.parse(serialized));

    return {
      ...command.data,
      span: spooled.span,
      resource: spooled.resource,
      instrumentationScope: spooled.instrumentationScope,
    };
  }

  private capAttributes({
    span,
    resource,
    tenantId,
    traceId,
    spanId,
  }: {
    span: OtlpSpan;
    resource: OtlpResource | null;
    tenantId: string;
    traceId: string;
    spanId: string;
  }): void {
    const cappedAttributeCount = capOversizedAttributes(
      span,
      resource,
      MAX_RECORDED_ATTRIBUTE_VALUE_BYTES,
    );
    if (cappedAttributeCount === 0) {
      return;
    }

    this.logger.warn(
      { tenantId, traceId, spanId, cappedAttributeCount },
      "Capped oversized span attribute value(s) before ingestion",
    );
  }

  private reportNonCriticalFailure(result: PromiseSettledResult<void>, message: string): void {
    if (result.status === "rejected") {
      this.logger.warn({ error: result.reason }, message);
    }
  }

  private stripReservedAttributes(span: OtlpSpan, resource: OtlpResource | null): void {
    const strip = (attributes: OtlpSpan["attributes"]): OtlpSpan["attributes"] =>
      attributes.filter((attribute) => {
        const reserved =
          attribute.key.startsWith(EventingRecordSpanAdapter.RESERVED_ATTRIBUTE_PREFIX) ||
          attribute.key === TRUNCATED_ATTRIBUTES_KEY;
        const allowed = EventingRecordSpanAdapter.RESERVED_ATTRIBUTE_PASSTHROUGH.has(attribute.key);
        if (!reserved || allowed) {
          return true;
        }

        this.logger.warn(
          { attributeKey: attribute.key },
          "Stripped a user-submitted reserved attribute",
        );
        return false;
      });

    span.attributes = strip(span.attributes);
    for (const event of span.events) {
      event.attributes = strip(event.attributes);
    }
    for (const link of span.links) {
      link.attributes = strip(link.attributes);
    }
    if (resource) {
      resource.attributes = strip(resource.attributes);
    }
  }
}

import { createLogger } from "@langwatch/observability";
import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import { SpanKind as ApiSpanKind, type Span as OtelSpan } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import {
  instrumentationScopeSchema,
  resourceSchema,
  SPAN_MAX_PAST_MS,
  spanSchema,
  type OtlpInstrumentationScope,
  type OtlpResource,
  type OtlpSpan,
  type PIIRedactionLevel,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import { TraceRequestUtils } from "./otlp-trace-request.rules";

export type SpanIngestionStatus = "collected" | "dropped" | "deduped" | "failed" | "filtered";

export type SpanIngestionResult = {
  status: SpanIngestionStatus;
  error?: string;
};

export type TraceRequestCollectionResult = {
  rejectedSpans: number;
  errorMessage: string;
};

/**
 * The span a dedup key is built from. Named because all three operations take
 * the same triple, and three bare strings in a fixed order is a lock key you
 * can build wrong without the compiler noticing.
 */
export type SpanDedupRef = {
  tenantId: string;
  traceId: string;
  spanId: string;
};

/** Redis-backed deduplication is app infrastructure, not Trace domain state. */
export abstract class TraceSpanDedupPort {
  abstract tryAcquireProcessingLock(span: SpanDedupRef): Promise<boolean | null>;

  abstract tryConfirmProcessed(span: SpanDedupRef): Promise<void>;

  abstract tryReleaseOnFailure(span: SpanDedupRef): Promise<void>;
}

/** The Trace pipeline's one named command handoff. */
export abstract class TraceIngressCommandPort {
  abstract recordSpan(data: RecordSpanCommandData): Promise<void>;
}

/** Optional edge/blob preparation, composed by the application when enabled. */
export abstract class TraceIngressPayloadPort {
  abstract prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData>;
}

/**
 * The outcome of every span in one export request.
 *
 * Only `dropped` and `failed` are a rejection: `filtered` and `deduped` are
 * spans we declined to store on purpose, and the transport turns
 * `rejectedSpans` into the sender's HTTP answer.
 */
class SpanIngestionTally {
  private readonly counts: Record<SpanIngestionStatus, number> = {
    collected: 0,
    dropped: 0,
    deduped: 0,
    failed: 0,
    filtered: 0,
  };
  private readonly errors: string[] = [];

  record(result: SpanIngestionResult): void {
    this.counts[result.status]++;
    if (result.error) {
      this.errors.push(result.error);
    }
  }

  describeOn(otelSpanRef: OtelSpan): void {
    otelSpanRef.setAttribute("spans.ingestion.successes", this.counts.collected);
    otelSpanRef.setAttribute("spans.ingestion.failures", this.counts.failed);
    otelSpanRef.setAttribute("spans.ingestion.drops", this.counts.dropped);
    otelSpanRef.setAttribute("spans.ingestion.deduped", this.counts.deduped);
    otelSpanRef.setAttribute("spans.ingestion.filtered", this.counts.filtered);
  }

  collectionResult(): TraceRequestCollectionResult {
    return {
      rejectedSpans: this.counts.dropped + this.counts.failed,
      errorMessage: this.errors.join("; "),
    };
  }
}

/**
 * Process-wide Trace receiver. Transport keeps auth and HTTP response mapping;
 * this service owns raw OTLP trace traversal, validation, filtering, dedup and
 * the handoff to the Trace command pipeline.
 */
export class TraceIngestionService {
  private readonly tracer = getLangWatchTracer("langwatch.trace-processing.span-ingestion");
  private readonly logger = createLogger("langwatch:trace-processing:span-ingestion");

  private constructor(
    private readonly codingAgents: CodingAgentService,
    private readonly codingAgentSpanFilterEnabled: boolean,
    private readonly dedup: TraceSpanDedupPort,
    private readonly commands: TraceIngressCommandPort,
    private readonly payloads: TraceIngressPayloadPort | undefined,
  ) {}

  static create(options: {
    codingAgents: CodingAgentService;
    codingAgentSpanFilterEnabled: boolean;
    dedup: TraceSpanDedupPort;
    commands: TraceIngressCommandPort;
    payloads?: TraceIngressPayloadPort;
  }): TraceIngestionService {
    return new TraceIngestionService(
      options.codingAgents,
      options.codingAgentSpanFilterEnabled,
      options.dedup,
      options.commands,
      options.payloads,
    );
  }

  async handleOtlpTraceRequest(
    tenantId: string,
    traceRequest: IExportTraceServiceRequest,
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<TraceRequestCollectionResult> {
    return await this.tracer.withActiveSpan(
      "TraceIngestionService.handleOtlpTraceRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          trace_request_count: traceRequest.resourceSpans?.length ?? 0,
        },
      },
      async (otelSpanRef) => {
        const tally = new SpanIngestionTally();

        for (const resourceSpan of traceRequest.resourceSpans ?? []) {
          const resource = this.parseResource(resourceSpan?.resource, tenantId);

          for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
            const scope = this.parseScope(scopeSpan?.scope, tenantId);

            for (const candidate of scopeSpan?.spans ?? []) {
              tally.record(
                await this.processSpan({
                  tenantId,
                  otelSpan: candidate,
                  resource,
                  scope,
                  piiRedactionLevel,
                  otelSpanRef,
                }),
              );
            }
          }
        }

        tally.describeOn(otelSpanRef);

        return tally.collectionResult();
      },
    );
  }

  /**
   * A resource or scope we cannot read is logged and treated as absent — the
   * spans underneath it are still the sender's data, and dropping a whole
   * batch over a malformed envelope loses more than it protects.
   */
  private parseResource(candidate: unknown, tenantId: string): OtlpResource | null {
    const result = resourceSchema.safeParse(candidate);
    if (!result.success) {
      this.logger.error({ result, tenantId }, "Error parsing OTLP resource");
    }

    return result.data ?? null;
  }

  private parseScope(candidate: unknown, tenantId: string): OtlpInstrumentationScope | null {
    const result = instrumentationScopeSchema.safeParse(candidate);
    if (!result.success) {
      this.logger.error({ result, tenantId }, "Error parsing OTLP scope");
    }

    return result.data ?? null;
  }

  async ingestNormalizedSpan(input: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
    piiRedactionLevel: PIIRedactionLevel;
    otelSpanRef?: OtelSpan;
  }): Promise<SpanIngestionResult> {
    let lockAcquired = false;

    try {
      const lockResult = await this.dedup.tryAcquireProcessingLock({
        tenantId: input.tenantId,
        traceId: input.span.traceId,
        spanId: input.span.spanId,
      });
      if (lockResult === false) {
        return { status: "deduped" };
      }

      lockAcquired = lockResult === true;

      const commandData: RecordSpanCommandData = {
        tenantId: input.tenantId,
        span: input.span,
        resource: input.resource,
        instrumentationScope: input.instrumentationScope,
        piiRedactionLevel: input.piiRedactionLevel,
        occurredAt: Date.now(),
      };
      const prepared = this.payloads ? await this.payloads.prepare(commandData) : commandData;

      await this.commands.recordSpan(prepared);
      await this.dedup.tryConfirmProcessed({
        tenantId: input.tenantId,
        traceId: input.span.traceId,
        spanId: input.span.spanId,
      });

      return { status: "collected" };
    } catch (error) {
      if (lockAcquired) {
        await this.dedup.tryReleaseOnFailure({
          tenantId: input.tenantId,
          traceId: input.span.traceId,
          spanId: input.span.spanId,
        });
      }

      input.otelSpanRef?.addEvent("span_ingestion_error", {
        "error.message": error instanceof Error ? error.message : String(error),
        "tenant.id": input.tenantId,
      });
      this.logger.error(
        { error, tenantId: input.tenantId, traceId: input.span.traceId, spanId: input.span.spanId },
        "Error dispatching span to the trace processing pipeline",
      );

      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async processSpan(input: {
    tenantId: string;
    otelSpan: unknown;
    resource: OtlpResource | null;
    scope: OtlpInstrumentationScope | null;
    piiRedactionLevel: PIIRedactionLevel;
    otelSpanRef: OtelSpan;
  }): Promise<SpanIngestionResult> {
    const spanParseResult = spanSchema.safeParse(input.otelSpan);
    if (!spanParseResult.success) {
      this.logger.warn(
        { result: spanParseResult, tenantId: input.tenantId },
        "Error parsing OTLP span, dropping",
      );

      return {
        status: "dropped",
        error: `span validation failed: ${spanParseResult.error.message}`,
      };
    }

    let startTimeUnixMs: number;
    try {
      startTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(
        TraceRequestUtils.normalizeOtlpUnixNano(spanParseResult.data.startTimeUnixNano),
      );
    } catch {
      return { status: "dropped", error: "span start time is invalid" };
    }

    if (startTimeUnixMs < Date.now() - SPAN_MAX_PAST_MS) {
      return { status: "dropped", error: "span start time is more than 31 days in the past" };
    }

    if (
      this.codingAgentSpanFilterEnabled &&
      this.codingAgents.shouldFilterSpan({
        scopeName: input.scope?.name,
        spanName: spanParseResult.data.name,
        attributeKeys: spanParseResult.data.attributes.map((attribute) => attribute.key),
      })
    ) {
      return { status: "filtered" };
    }

    return await this.ingestNormalizedSpan({
      tenantId: input.tenantId,
      span: this.withHexIds(spanParseResult.data),
      resource: input.resource,
      instrumentationScope: input.scope,
      piiRedactionLevel: input.piiRedactionLevel,
      otelSpanRef: input.otelSpanRef,
    });
  }

  /** Ids arrive as raw bytes over protobuf and as hex over JSON; dedup and the pipeline want one of them. */
  private withHexIds(span: OtlpSpan): OtlpSpan {
    const hex = TraceRequestUtils.normalizeOtlpId;

    return {
      ...span,
      traceId: hex(span.traceId),
      spanId: hex(span.spanId),
      parentSpanId: span.parentSpanId ? hex(span.parentSpanId) : span.parentSpanId,
      links: span.links.map((link) => ({
        ...link,
        traceId: hex(link.traceId),
        spanId: hex(link.spanId),
      })),
    };
  }
}

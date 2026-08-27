import { createLogger } from "@langwatch/observability";
import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import { SpanKind as ApiSpanKind, type Span as OtelSpan } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import {
  instrumentationScopeSchema,
  resourceSchema,
  spanSchema,
  type OtlpInstrumentationScope,
  type OtlpResource,
  type OtlpSpan,
  type PIIRedactionLevel,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Maximum accepted span age, shared by OTLP and REST collector intake. */
export const SPAN_MAX_PAST_MS = 31 * ONE_DAY_MS;

export type SpanIngestionStatus = "collected" | "dropped" | "deduped" | "failed" | "filtered";

export type SpanIngestionResult = {
  status: SpanIngestionStatus;
  error?: string;
};

export type TraceRequestCollectionResult = {
  rejectedSpans: number;
  errorMessage: string;
};

/** Redis-backed deduplication is app infrastructure, not Trace domain state. */
export abstract class TraceSpanDedupPort {
  abstract tryAcquireProcessingLock(
    tenantId: string,
    traceId: string,
    spanId: string,
  ): Promise<boolean | null>;

  abstract tryConfirmProcessed(tenantId: string, traceId: string, spanId: string): Promise<void>;

  abstract tryReleaseOnFailure(tenantId: string, traceId: string, spanId: string): Promise<void>;
}

/** The Trace pipeline's one named command handoff. */
export abstract class TraceIngressCommandPort {
  abstract recordSpan(data: RecordSpanCommandData): Promise<void>;
}

/** Optional edge/blob preparation, composed by the application when enabled. */
export abstract class TraceIngressPayloadPort {
  abstract prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData>;
}

function normalizeOtlpId(id: string | Uint8Array): string {
  return id instanceof Uint8Array ? Buffer.from(id).toString("hex") : id;
}

function unixMillis(value: unknown): number {
  if (typeof value === "number") {
    return Math.floor(value / 1e6);
  }
  if (typeof value === "string") {
    return Math.floor(Number.parseInt(value, 10) / 1e6);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "high" in value &&
    "low" in value &&
    typeof value.high === "number" &&
    typeof value.low === "number"
  ) {
    const nanos = Number((BigInt(value.high) << 32n) | (BigInt(value.low) & 0xffffffffn));

    return Math.floor(nanos / 1e6);
  }

  throw new Error("Invalid Unix nano value");
}

function normalizeSpanIds(span: OtlpSpan): OtlpSpan {
  return {
    ...span,
    traceId: normalizeOtlpId(span.traceId),
    spanId: normalizeOtlpId(span.spanId),
    parentSpanId: span.parentSpanId ? normalizeOtlpId(span.parentSpanId) : span.parentSpanId,
    links: span.links.map((link) => ({
      ...link,
      traceId: normalizeOtlpId(link.traceId),
      spanId: normalizeOtlpId(link.spanId),
    })),
  };
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
        let collectedSpanCount = 0;
        let droppedSpanCount = 0;
        let dedupedSpanCount = 0;
        let ingestionFailureCount = 0;
        let filteredSpanCount = 0;
        const errors: string[] = [];

        for (const resourceSpan of traceRequest.resourceSpans ?? []) {
          const resourceParseResult = resourceSchema.safeParse(resourceSpan?.resource);
          if (!resourceParseResult.success) {
            this.logger.error(
              { result: resourceParseResult, tenantId },
              "Error parsing OTLP resource",
            );
          }

          for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
            const scopeParseResult = instrumentationScopeSchema.safeParse(scopeSpan?.scope);
            if (!scopeParseResult.success) {
              this.logger.error({ result: scopeParseResult, tenantId }, "Error parsing OTLP scope");
            }

            for (const candidate of scopeSpan?.spans ?? []) {
              const result = await this.processSpan({
                tenantId,
                otelSpan: candidate,
                resource: resourceParseResult.data ?? null,
                scope: scopeParseResult.data ?? null,
                piiRedactionLevel,
                otelSpanRef,
              });

              switch (result.status) {
                case "collected":
                  collectedSpanCount++;
                  break;
                case "dropped":
                  droppedSpanCount++;
                  break;
                case "deduped":
                  dedupedSpanCount++;
                  break;
                case "failed":
                  ingestionFailureCount++;
                  break;
                case "filtered":
                  filteredSpanCount++;
                  break;
              }

              if (result.error) {
                errors.push(result.error);
              }
            }
          }
        }

        otelSpanRef.setAttribute("spans.ingestion.successes", collectedSpanCount);
        otelSpanRef.setAttribute("spans.ingestion.failures", ingestionFailureCount);
        otelSpanRef.setAttribute("spans.ingestion.drops", droppedSpanCount);
        otelSpanRef.setAttribute("spans.ingestion.deduped", dedupedSpanCount);
        otelSpanRef.setAttribute("spans.ingestion.filtered", filteredSpanCount);

        return {
          rejectedSpans: droppedSpanCount + ingestionFailureCount,
          errorMessage: errors.join("; "),
        };
      },
    );
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
      const lockResult = await this.dedup.tryAcquireProcessingLock(
        input.tenantId,
        input.span.traceId,
        input.span.spanId,
      );
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
      await this.dedup.tryConfirmProcessed(input.tenantId, input.span.traceId, input.span.spanId);

      return { status: "collected" };
    } catch (error) {
      if (lockAcquired) {
        await this.dedup.tryReleaseOnFailure(input.tenantId, input.span.traceId, input.span.spanId);
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
      startTimeUnixMs = unixMillis(spanParseResult.data.startTimeUnixNano);
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
      span: normalizeSpanIds(spanParseResult.data),
      resource: input.resource,
      instrumentationScope: input.scope,
      piiRedactionLevel: input.piiRedactionLevel,
      otelSpanRef: input.otelSpanRef,
    });
  }
}

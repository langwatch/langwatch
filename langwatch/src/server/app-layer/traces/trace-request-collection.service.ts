import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { PIIRedactionLevel } from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { RecordSpanCommandData } from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import {
  instrumentationScopeSchema,
  type OtlpSpan,
  resourceSchema,
  spanSchema,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { TraceRequestUtils } from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
import type { SpanDedupService } from "./span-dedupe.service";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SPAN_MAX_PAST_MS = 31 * ONE_DAY_MS;

/** An OtlpSpan whose ID fields have been normalized to hex strings. */
type NormalizedIdSpan = OtlpSpan & { traceId: string; spanId: string };

/**
 * Normalizes all ID fields in a span to hex strings before queuing.
 * This prevents issues with Uint8Array serialization through JSON (BullMQ/Redis),
 * where Uint8Array becomes {"0": 133, "1": 93, ...} objects.
 */
function normalizeSpanIds(span: OtlpSpan): NormalizedIdSpan {
  return {
    ...span,
    traceId: TraceRequestUtils.normalizeOtlpId(span.traceId),
    spanId: TraceRequestUtils.normalizeOtlpId(span.spanId),
    parentSpanId: span.parentSpanId
      ? TraceRequestUtils.normalizeOtlpId(span.parentSpanId)
      : span.parentSpanId,
    links: span.links.map((link) => ({
      ...link,
      traceId: TraceRequestUtils.normalizeOtlpId(link.traceId),
      spanId: TraceRequestUtils.normalizeOtlpId(link.spanId),
    })),
  };
}

export interface TraceRequestCollectionResult {
  rejectedSpans: number;
  errorMessage: string;
}

export interface TraceRequestCollectionDeps {
  dedup: SpanDedupService;
  recordSpan: (data: RecordSpanCommandData) => Promise<void>;
}

/**
 * Service for collecting trace requests into the trace processing pipeline.
 *
 * Normalizes OTLP trace requests and sends each span as a span-received event
 * into the trace processing pipeline.
 */
export class TraceRequestCollectionService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-ingestion",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-ingestion",
  );

  constructor(private readonly deps: TraceRequestCollectionDeps) {}

  /**
   * Deserializes the OTLP request (JSON or protobuf), iterates through all spans,
   * normalizing the data into a more stable data structure, and sends each span to the
   * trace processing pipeline as span received events.
   */
  async handleOtlpTraceRequest(
    tenantId: string,
    traceRequest: IExportTraceServiceRequest,
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<TraceRequestCollectionResult> {
    return await this.tracer.withActiveSpan(
      "TraceRequestCollectionService.handleOtlpTraceRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          trace_request_count: traceRequest.resourceSpans?.length ?? 0,
        },
      },
      async (span) => {
        let collectedSpanCount = 0;
        let droppedSpanCount = 0;
        let dedupedSpanCount = 0;
        let ingestionFailureCount = 0;
        const errors: string[] = [];

        for (const resourceSpan of traceRequest.resourceSpans ?? []) {
          const resource = resourceSpan?.resource;
          const resourceParseResult = resourceSchema.safeParse(resource);
          if (!resourceParseResult.success) {
            this.logger.error(
              { result: resourceParseResult, tenantId },
              "Error parsing OTLP resource",
            );
          }

          for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
            const scope = scopeSpan?.scope;
            const scopeParseResult =
              instrumentationScopeSchema.safeParse(scope);
            if (!scopeParseResult.success) {
              this.logger.error(
                { result: scopeParseResult, tenantId },
                "Error parsing OTLP scope",
              );
            }

            for (const otelSpan of scopeSpan?.spans ?? []) {
              const result = await this.processSpan({
                tenantId,
                otelSpan,
                resource: resourceParseResult.data ?? null,
                scope: scopeParseResult.data ?? null,
                piiRedactionLevel,
                otelSpanRef: span,
              });

              switch (result.status) {
                case "collected": collectedSpanCount++; break;
                case "dropped":   droppedSpanCount++;   break;
                case "deduped":   dedupedSpanCount++;   break;
                case "failed":    ingestionFailureCount++; break;
              }
              if (result.error) {
                errors.push(result.error);
              }
            }
          }
        }

        span.setAttribute("spans.ingestion.successes", collectedSpanCount);
        span.setAttribute("spans.ingestion.failures", ingestionFailureCount);
        span.setAttribute("spans.ingestion.drops", droppedSpanCount);
        span.setAttribute("spans.ingestion.deduped", dedupedSpanCount);

        const rejectedSpans = droppedSpanCount + ingestionFailureCount;
        return {
          rejectedSpans,
          errorMessage: errors.join("; "),
        };
      },
    );
  }

  private async processSpan({
    tenantId,
    otelSpan,
    resource,
    scope,
    piiRedactionLevel,
    otelSpanRef,
  }: {
    tenantId: string;
    otelSpan: unknown;
    resource: import("../../event-sourcing/pipelines/trace-processing/schemas/otlp").OtlpResource | null;
    scope: import("../../event-sourcing/pipelines/trace-processing/schemas/otlp").OtlpInstrumentationScope | null;
    piiRedactionLevel: PIIRedactionLevel;
    otelSpanRef: import("@opentelemetry/api").Span;
  }): Promise<{ status: "collected" | "dropped" | "deduped" | "failed"; error?: string }> {
    const spanParseResult = spanSchema.safeParse(otelSpan);
    if (!spanParseResult.success) {
      this.logger.warn(
        { result: spanParseResult, tenantId },
        "Error parsing OTLP span, dropping",
      );
    }
    if (!spanParseResult.data) {
      return {
        status: "dropped",
        error: `span validation failed: ${spanParseResult.error?.message ?? "unknown"}`,
      };
    }

    const startTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(
      TraceRequestUtils.normalizeOtlpUnixNano(spanParseResult.data.startTimeUnixNano),
    );
    const now = Date.now();

    if (startTimeUnixMs < now - SPAN_MAX_PAST_MS) {
      return { status: "dropped", error: "span start time is more than 31 days in the past" };
    }

    const normalizedSpan = normalizeSpanIds(spanParseResult.data);
    let lockAcquired = false;

    try {
      const lockResult = await this.deps.dedup.tryAcquireProcessingLock(
        tenantId,
        normalizedSpan.traceId,
        normalizedSpan.spanId,
      );
      if (lockResult === false) {
        return { status: "deduped" };
      }
      lockAcquired = lockResult === true;

      await this.deps.recordSpan({
        tenantId,
        span: normalizedSpan,
        resource,
        instrumentationScope: scope,
        piiRedactionLevel,
        occurredAt: Date.now(),
      });

      await this.deps.dedup.tryConfirmProcessed(
        tenantId,
        normalizedSpan.traceId,
        normalizedSpan.spanId,
      );

      return { status: "collected" };
    } catch (error) {
      if (lockAcquired) {
        await this.deps.dedup.tryReleaseOnFailure(
          tenantId,
          normalizedSpan.traceId,
          normalizedSpan.spanId,
        );
      }

      otelSpanRef.addEvent("span_ingestion_error", {
        "error.message":
          error instanceof Error ? error.message : String(error),
        "tenant.id": tenantId,
      });
      this.logger.error(
        {
          error,
          tenantId,
          traceId: normalizedSpan.traceId,
          spanId: normalizedSpan.spanId,
        },
        "Error converting raw OTEL span",
      );
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

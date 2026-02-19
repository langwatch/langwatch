import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../utils/logger/server";
import { getApp } from "../app-layer/app";
import type { PIIRedactionLevel } from "../event-sourcing/pipelines/trace-processing/schemas/commands";
import {
  instrumentationScopeSchema,
  type OtlpSpan,
  resourceSchema,
  spanSchema,
} from "../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { TraceRequestUtils } from "../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";

/**
 * Normalizes all ID fields in a span to hex strings before queuing.
 * This prevents issues with Uint8Array serialization through JSON (BullMQ/Redis),
 * where Uint8Array becomes {"0": 133, "1": 93, ...} objects.
 */
function normalizeSpanIds(span: OtlpSpan): OtlpSpan {
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

/**
 * Service for collecting trace requests into the trace processing pipeline.
 *
 * This service normalizes the trace requests, and sends them as span received events into
 * the trace processing pipeline.
 */
export class TraceRequestCollectionService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-ingestion",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-ingestion",
  );

  /**
   * Deserializes the OTLP request (JSON or protobuf), iterates through all spans,
   * normalizing the data into a more stable data structure, and sends each span to the
   * trace processing pipeline as span received events.
   *
   * @param tenantId - The tenant ID (project ID).
   * @param traceRequest - The OTLP trace request.
   * @param piiRedactionLevel - The PII redaction level for the project.
   * @returns A promise that resolves when all spans have been ingested.
   *
   * @example
   * ```typescript
   * await traceRequestCollectionService.handleOtlpTraceRequest(
   *   projectId,
   *   traceRequest,
   *   "ESSENTIAL",
   * );
   * ```
   */
  async handleOtlpTraceRequest(
    tenantId: string,
    traceRequest: IExportTraceServiceRequest,
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<void> {
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
        let ingestionFailureCount = 0;

        // Iterate through resourceSpans → scopeSpans → spans
        for (const resourceSpan of traceRequest.resourceSpans ?? []) {
          const resource = resourceSpan?.resource;
          const resourceParseResult = resourceSchema.safeParse(resource);
          if (!resourceParseResult.success) {
            this.logger.error(
              {
                result: resourceParseResult,
                tenantId,
              },
              "Error parsing OTLP resource",
            );
          }

          // Iterate through scopeSpans → spans
          for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
            const scope = scopeSpan?.scope;
            const scopeParseResult =
              instrumentationScopeSchema.safeParse(scope);
            if (!scopeParseResult.success) {
              this.logger.error(
                {
                  result: scopeParseResult,
                  tenantId,
                },
                "Error parsing OTLP scope",
              );
            }

            // Iterate through spans. We require span data to pass validation, but allow
            // scope/resource to be broken - if they are we just do not include them.
            // We log all validation failures as warnings for resource/scope, but for
            // spans we only log as error and drop the span.
            for (const otelSpan of scopeSpan?.spans ?? []) {
              const spanParseResult = spanSchema.safeParse(otelSpan);
              if (!spanParseResult.success) {
                this.logger.warn(
                  {
                    result: spanParseResult,
                    tenantId,
                  },
                  "Error parsing OTLP span, dropping",
                );
              }
              // Dropping broken span - needed to enforce type safety.
              if (!spanParseResult.data) {
                droppedSpanCount++;
                continue;
              }

              try {
                // Normalize IDs to hex strings before queuing to avoid
                // Uint8Array serialization issues through JSON (BullMQ/Redis)
                const normalizedSpan = normalizeSpanIds(spanParseResult.data);

                await getApp().traces.recordSpan({
                  tenantId,
                  span: normalizedSpan,
                  resource: resourceParseResult.data ?? null,
                  instrumentationScope: scopeParseResult.data ?? null,
                  piiRedactionLevel,
                  occurredAt: Date.now(),
                });

                collectedSpanCount++;
              } catch (error) {
                span.addEvent("span_ingestion_error", {
                  "error.message":
                    error instanceof Error ? error.message : String(error),
                  "tenant.id": tenantId,
                });
                this.logger.error(
                  {
                    error,
                    tenantId,
                    traceId: spanParseResult.data.traceId,
                    spanId: spanParseResult.data.spanId,
                  },
                  "Error converting raw OTEL span",
                );
                ingestionFailureCount++;
              }
            }
          }
        }

        span.setAttribute("spans.ingestion.successes", collectedSpanCount);
        span.setAttribute("spans.ingestion.failures", ingestionFailureCount);
        span.setAttribute("spans.ingestion.drops", droppedSpanCount);
      },
    );
  }
}

export const traceRequestCollectionService =
  new TraceRequestCollectionService();

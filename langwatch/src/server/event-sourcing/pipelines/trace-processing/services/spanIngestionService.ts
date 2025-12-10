import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { DeepPartial } from "../../../../../utils/types";
import type { TraceForCollection } from "../../../../tracer/otel.traces";
import { traceProcessingPipeline } from "../pipeline";
import { SpanProcessingMapperService } from "./spanProcessingMapperService";

/**
 * Service for ingesting spans into the trace processing pipeline.
 *
 * @example
 * ```typescript
 * await spanIngestionService.ingestSpanCollection(
 *   projectId,
 *   traceForCollection,
 *   traceRequest,
 * );
 * ```
 */
export class SpanIngestionService {
  tracer = getLangWatchTracer("langwatch.trace-processing.span-ingestion");
  logger = createLogger("langwatch:trace-processing:span-ingestion");
  private readonly mapperService = new SpanProcessingMapperService();

  /**
   * Ingests a span collection into the LangWatch platform by mapping its spans to
   * commands and sending them through the trace processing pipeline.
   *
   * @param tenantId - The tenant ID.
   * @param traceForCollection - The trace for collection.
   * @param traceRequest - The trace request.
   * @returns A promise that resolves when the trace has been ingested.
   */
  async ingestSpanCollection(
    tenantId: string,
    traceForCollection: TraceForCollection,
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "SpanIngestionService.ingestSpanCollection",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceForCollection.traceId,
          "spans.count": traceForCollection.spans.length,
        },
      },
      async (span) => {
        const records = this.mapperService.mapLangWatchSpansToOtelReadableSpans(
          traceForCollection,
          traceRequest,
          tenantId,
        );

        if (records.length === 0) {
          this.logger.debug(
            {
              tenantId,
              traceId: traceForCollection.traceId,
            },
            "No spans mapped for processing",
          );
          return;
        }

        for (const record of records) {
          const command = {
            tenantId,
            spanData: this.mapperService.mapReadableSpanToSpanData(
              record.readableSpan,
            ),
            collectedAtUnixMs: Date.now(),
          };

          await traceProcessingPipeline.commands.recordSpan.send(command);
        }

        span.setAttributes({
          "readable.spans.mapped": records.length,
          "readable.spans.mapped_ids": records.map(
            (record) => record.readableSpan.spanContext().spanId,
          ),
        });
      },
    );
  }
}

export const spanIngestionService = new SpanIngestionService();


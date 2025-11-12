import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { TraceForCollection } from "../../../tracer/otel.traces";
import type { DeepPartial } from "../../../../utils/types";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { mapLangWatchSpansToOtelReadableSpans } from "../mapper/mapLangWatchToOtelGenAi";
import {
  type SpanIngestionWriteProducer,
  spanIngestionWriteProducer,
} from "../producers/spanIngestionWriteProducer";
import { createLogger } from "../../../../utils/logger";

export class SpanIngestionService {
  tracer = getLangWatchTracer("langwatch.span-ingestion.service");
  logger = createLogger("langwatch.span-ingestion.service");

  constructor(private readonly producer: SpanIngestionWriteProducer) {}

  /**
   * Consumes spans to be ingested by the LangWatch platform.
   * @param tenantId - The tenant ID.
   * @param traceForCollection - The trace for collection.
   * @param traceRequest - The trace request.
   * @returns A promise that resolves when the spans have been consumed.
   */
  async consumeSpans(
    tenantId: string,
    traceForCollection: TraceForCollection,
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
    "SpanIngestionService.consumeSpans",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceForCollection.traceId,
          "spans.count": traceForCollection.spans.length,
        },
      },
      async (span) => {
        const records = mapLangWatchSpansToOtelReadableSpans(
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
            "No spans mapped for ClickHouse ingestion",
          );
          return;
        }

        for (const record of records) {
          await this.producer.enqueueSpanIngestionWriteJob(
            tenantId,
            record.readableSpan,
          );
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

export const spanIngestionService = new SpanIngestionService(
  spanIngestionWriteProducer,
);

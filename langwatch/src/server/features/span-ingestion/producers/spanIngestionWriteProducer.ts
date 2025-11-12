import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import {
  spanIngestionWriteQueue,
  SPAN_INGESTION_WRITE_JOB_NAME,
} from "../../../background/queues/spanIngestionWriteQueue";
import type { SpanIngestionWriteJob, SpanIngestionWriteRecord, IngestedSpan } from "../types";
import { createLogger } from "../../../utils/logging";

export class SpanIngestionWriteProducer {
  tracer = getLangWatchTracer("langwatch.span-ingestion.write.producer");
  logger = createLogger("langwatch.span-ingestion.write.producer");

  async enqueueSpanWriteJob(
    tenantId: string,
    traceId: string,
    span: IngestedSpan,
    collectedAt: number,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanIngestionProducer.enqueueClickHouseJob",
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          "project.id": tenantId,
          "trace.id": traceId,
          "span.id": span.spanId,
        },
      },
      async () => {
        await spanIngestionWriteQueue.add(
          SPAN_INGESTION_WRITE_JOB_NAME,
          this.buildJobPayload(tenantId, traceId, span, collectedAt),
          {
            jobId: this.buildJobId(tenantId, span.spanId),
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      },
    );
  }

  private buildJobId(tenantId: string, spanId: string): string {
    return `${tenantId}:${spanId}`;
  }

  private buildJobPayload(
    tenantId: string,
    traceId: string,
    span: IngestedSpan,
    collectedAt: number,
  ): SpanIngestionWriteJob {
    return {
      tenantId,
      traceId,
      spanId: span.spanId,
      spanData: span,
      collectedAt,
    } satisfies SpanIngestionWriteJob;
  }
}

export const spanIngestionWriteProducer = new SpanIngestionWriteProducer();

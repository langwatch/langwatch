import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import {
  spanIngestionWriteQueue,
  SPAN_INGESTION_WRITE_JOB_NAME,
} from "../../../background/queues/spanIngestionWriteQueue";
import type { SpanIngestionWriteJob } from "../types";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { createLogger } from "../../../../utils/logger";

export class SpanIngestionWriteProducer {
  tracer = getLangWatchTracer("langwatch.span-ingestion.write.producer");
  logger = createLogger("langwatch.span-ingestion.write.producer");

  async enqueueSpanIngestionWriteJob(
    tenantId: string,
    span: ReadableSpan,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanIngestionProducer.enqueueSpanIngestionWriteJob",
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          "project.id": tenantId,
          "trace.id": span.spanContext().traceId,
          "span.id": span.spanContext().spanId,
        },
      },
      async () => {
        await spanIngestionWriteQueue.add(
          SPAN_INGESTION_WRITE_JOB_NAME,
          this.buildJobPayload(tenantId, span),
          {
            jobId: this.buildJobId(tenantId, span.spanContext().spanId),
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
    spanData: ReadableSpan,
  ): SpanIngestionWriteJob {
    return {
      tenantId,
      spanData,
      collectedAtUnixMs: new Date().getTime(),
    } satisfies SpanIngestionWriteJob;
  }
}

export const spanIngestionWriteProducer = new SpanIngestionWriteProducer();

import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import {
  spanIngestionWriteQueue,
  SPAN_INGESTION_WRITE_JOB_NAME,
} from "../../../background/queues/spanIngestionWriteQueue";
import type { SpanIngestionWriteJob } from "../types/";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { createLogger } from "../../../../utils/logger";
import { mapReadableSpanToSpanIngestionWriteJobData } from "../mapper/readableSpanToSpanIngestionWriteJobData";

export class SpanIngestionWriteProducerBullMq {
  tracer = getLangWatchTracer("langwatch.span-ingestion.write.producer");
  logger = createLogger("langwatch.span-ingestion.write.producer");

  async enqueueSpanIngestionWriteJob(
    tenantId: string,
    span: ReadableSpan,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanIngestionWriteProducerBullMq.enqueueSpan",
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          "tenant_id": tenantId,
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
    span: ReadableSpan,
  ): SpanIngestionWriteJob {
    return {
      tenantId,
      spanData: mapReadableSpanToSpanIngestionWriteJobData(span),
      collectedAtUnixMs: new Date().getTime(),
    } satisfies SpanIngestionWriteJob;
  }
}

export const spanIngestionWriteProducerBullMq = new SpanIngestionWriteProducerBullMq();

import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { TraceProjectionConsumer } from "./traceProjectionConsumer";
import type { TraceProjectionJob } from "../types";
import type { TraceProcessingService } from "../services/traceProcessingService";
import { createLogger } from "../../../../utils/logger";

export class TraceProjectionConsumerBullMq implements TraceProjectionConsumer {
  tracer = getLangWatchTracer("langwatch.trace-processing.consumer.bullmq");
  logger = createLogger("langwatch:trace-processing:consumer:bullmq");

  constructor(private readonly traceProcessingService: TraceProcessingService) {}

  async consume(job: TraceProjectionJob): Promise<void> {
    return await this.tracer.withActiveSpan(
      "TraceProjectionConsumerBullMq.consume",
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          "tenant.id": job.tenantId,
          "trace.id": job.traceId,
          "span.id": job.jobData.spanId,
        },
      },
      async () => {
        const { tenantId, traceId } = job;
        const spanId = job.jobData.spanId;
        try {
          this.logger.info({ tenantId, traceId, spanId }, "Processing trace projection job");

          const projection = await this.traceProcessingService.rebuildProjection(traceId, {
            eventStoreContext: { tenantId },
            projectionStoreContext: { tenantId },
          });

          this.logger.info(
            {
              tenantId,
              traceId,
              spanCount: projection.data.spanCount,
              duration: projection.data.totalDurationMs,
            },
            "Trace projection computed successfully"
          );
        } catch (error) {
          this.logger.error(
            {
              tenantId,
              traceId,
              spanId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to process trace projection job"
          );
          throw error;
        }
      }
    );
  }
}


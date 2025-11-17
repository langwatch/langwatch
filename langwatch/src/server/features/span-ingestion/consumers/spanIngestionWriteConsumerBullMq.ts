import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { SpanIngestionWriteConsumer } from "./spanIngestionWriteConsumer";
import type { SpanIngestionWriteRepository } from "../repositories/spanIngestionWriteRepository";
import type { SpanIngestionWriteJob } from "../types/spanIngestionWriteJob";
import { createLogger } from "../../../../utils/logger";

export class SpanIngestionWriteConsumerBullMq implements SpanIngestionWriteConsumer {
  tracer = getLangWatchTracer("langwatch.span-ingestion.write.consumer.bullmq");
  logger = createLogger("langwatch:span-ingestion:write:consumer:bullmq");

  constructor(private readonly repository: SpanIngestionWriteRepository) {}

  async consume(jobData: SpanIngestionWriteJob): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanIngestionWriteConsumerBullMq.consume",
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          "tenant.id": jobData.tenantId,
          "span.id": jobData.spanData.spanId,
          "trace.id": jobData.spanData.traceId,
          "collected_at_unix_ms": jobData.collectedAtUnixMs,
        },
      },
      async () => {
        this.logger.info({
          tenantId: jobData.tenantId,
          spanId: jobData.spanData.spanId,
          traceId: jobData.spanData.traceId,
          collectedAtUnixMs: jobData.collectedAtUnixMs,
        }, "Consuming span ingestion write job");

        await this.repository.insertSpan(jobData);
      },
    );
  }
}

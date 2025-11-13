import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind, type Attributes } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { generate } from "@langwatch/ksuid";

import type { SpanIngestionWriteRepository } from "./spanIngestionWriteRepository";
import type { SpanIngestionWriteJob } from "../types/";
import { createLogger } from "../../../../utils/logger";

export class SpanIngestionWriteRepositoryMemory
  implements SpanIngestionWriteRepository
{
  tracer = getLangWatchTracer(
    "langwatch.span-ingestion.write.repository.memory",
  );
  logger = createLogger("langwatch:span-ingestion:write:repository:memory");

  async insertSpan(jobData: SpanIngestionWriteJob): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanIngestionWriteRepositoryMemory.insertSpan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          tenant_id: jobData.tenantId,
          "span.id": jobData.spanData.spanId,
          "trace.id": jobData.spanData.traceId,
        },
      },
      async () => {
        try {
          this.logger.info({ jobData }, "Span inserted into memory");
        } catch (error) {
          this.logger.error(
            {
              tenantId: jobData.tenantId,
              spanId: jobData.spanData.spanId,
              traceId: jobData.spanData.traceId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to insert span into memory",
          );

          throw error;
        }
      },
    );
  }
}

import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { SpanRepository } from "./spanRepository";
import type { StoreSpanIngestionCommandData } from "../types/storeSpanIngestionCommand";
import { createLogger } from "../../../../../utils/logger";

export class SpanRepositoryMemory implements SpanRepository {
  tracer = getLangWatchTracer("langwatch.span-repository.memory");
  logger = createLogger("langwatch:span-repository:memory");

  async insertSpan(command: StoreSpanIngestionCommandData): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanRepositoryMemory.insertSpan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": command.tenantId,
          "span.id": command.spanData.spanId,
          "trace.id": command.spanData.traceId,
        },
      },
      async () => {
        try {
          this.logger.info({ command }, "Span inserted into memory");
        } catch (error) {
          this.logger.error(
            {
              tenantId: command.tenantId,
              spanId: command.spanData.spanId,
              traceId: command.spanData.traceId,
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


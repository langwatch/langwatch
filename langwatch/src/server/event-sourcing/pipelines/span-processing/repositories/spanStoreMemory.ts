import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { SpanStore, SpanStoreCommand } from "./spanStore";
import { createLogger } from "../../../../../utils/logger";

export class SpanStoreMemory implements SpanStore {
  tracer = getLangWatchTracer("langwatch.span-store.memory");
  logger = createLogger("langwatch:span-store:memory");

  async insertSpan(command: SpanStoreCommand): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanStoreMemory.insertSpan",
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

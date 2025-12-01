import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { generate } from "@langwatch/ksuid";

import type { SpanRepository } from "./spanRepository";
import type {
  StoreSpanIngestionCommandData,
  SpanData,
} from "../schemas/commands";
import { createLogger } from "../../../../../utils/logger";

export class SpanRepositoryMemory implements SpanRepository {
  tracer = getLangWatchTracer("langwatch.span-repository.memory");
  logger = createLogger("langwatch:span-repository:memory");
  private readonly spans = new Map<string, SpanData>();

  private getKey(tenantId: string, traceId: string, spanId: string): string {
    return `${tenantId}:${traceId}:${spanId}`;
  }

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
          const key = this.getKey(
            command.tenantId,
            command.spanData.traceId,
            command.spanData.spanId,
          );
          // Add id and tenantId to spanData for storage
          // id is generated, tenantId comes from command
          const completeSpanData: SpanData = {
            ...command.spanData,
            id: generate("span").toString(),
            tenantId: command.tenantId,
          };
          // Idempotent: overwrite if exists
          this.spans.set(key, completeSpanData);
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

  async getSpanByTraceIdAndSpanId(
    tenantId: string,
    traceId: string,
    spanId: string,
  ): Promise<SpanData | null> {
    return await this.tracer.withActiveSpan(
      "SpanRepositoryMemory.getSpanByTraceIdAndSpanId",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "span.id": spanId,
          "trace.id": traceId,
        },
      },
      async () => {
        const key = this.getKey(tenantId, traceId, spanId);
        const span = this.spans.get(key);
        return span ?? null;
      },
    );
  }

  async getSpansByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<SpanData[]> {
    return await this.tracer.withActiveSpan(
      "SpanRepositoryMemory.getSpansByTraceId",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceId,
        },
      },
      async () => {
        const spans: SpanData[] = [];
        for (const [key, span] of this.spans.entries()) {
          if (key.startsWith(`${tenantId}:${traceId}:`)) {
            spans.push(span);
          }
        }
        // Sort by start time
        return spans.sort((a, b) => a.startTimeUnixMs - b.startTimeUnixMs);
      },
    );
  }
}

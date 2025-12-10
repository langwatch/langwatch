import { generate } from "@langwatch/ksuid";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { SpanData } from "../schemas/commands";
import type { SpanRepository, StoreSpanData } from "./spanRepository";

/**
 * In-memory implementation of the SpanRepository.
 * Useful for testing and development.
 */
export class SpanRepositoryMemory implements SpanRepository {
  tracer = getLangWatchTracer("langwatch.trace-processing.span-repository-memory");
  logger = createLogger("langwatch:trace-processing:span-repository-memory");
  private readonly spans = new Map<string, SpanData>();

  private getKey(tenantId: string, traceId: string, spanId: string): string {
    return `${tenantId}:${traceId}:${spanId}`;
  }

  async insertSpan(data: StoreSpanData): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanRepositoryMemory.insertSpan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": data.tenantId,
          "span.id": data.spanData.spanId,
          "trace.id": data.spanData.traceId,
        },
      },
      async () => {
        try {
          const key = this.getKey(
            data.tenantId,
            data.spanData.traceId,
            data.spanData.spanId,
          );
          // Ensure id and tenantId are set
          const completeSpanData: SpanData = {
            ...data.spanData,
            id: data.spanData.id || generate("span").toString(),
            tenantId: data.tenantId,
          };
          // Idempotent: overwrite if exists
          this.spans.set(key, completeSpanData);
          this.logger.debug(
            {
              tenantId: data.tenantId,
              spanId: data.spanData.spanId,
              traceId: data.spanData.traceId,
            },
            "Span inserted into memory",
          );
        } catch (error) {
          this.logger.error(
            {
              tenantId: data.tenantId,
              spanId: data.spanData.spanId,
              traceId: data.spanData.traceId,
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


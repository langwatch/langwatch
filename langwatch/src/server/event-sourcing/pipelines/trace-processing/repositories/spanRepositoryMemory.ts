import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { NormalizedSpan } from "../schemas/spans";
import { IdUtils } from "../utils/id.utils";
import type { SpanRepository } from "./spanRepository";

/**
 * In-memory implementation of the SpanRepository.
 * Useful for testing and development.
 */
export class SpanRepositoryMemory implements SpanRepository {
  tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-repository-memory",
  );
  logger = createLogger("langwatch:trace-processing:span-repository-memory");
  private readonly spans = new Map<string, NormalizedSpan>();

  private getKey(tenantId: string, traceId: string, spanId: string): string {
    return `${tenantId}:${traceId}:${spanId}`;
  }

  async insertSpan(data: NormalizedSpan): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanRepositoryMemory.insertSpan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": data.tenantId,
          "span.id": data.spanId,
          "trace.id": data.traceId,
        },
      },
      async () => {
        try {
          const key = this.getKey(data.tenantId, data.traceId, data.spanId);

          this.spans.set(key, data);
          this.logger.debug(
            {
              tenantId: data.tenantId,
              spanId: data.spanId,
              traceId: data.traceId,
            },
            "Span inserted into memory",
          );
        } catch (error) {
          this.logger.error(
            {
              tenantId: data.tenantId,
              spanId: data.spanId,
              traceId: data.traceId,
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
  ): Promise<NormalizedSpan | null> {
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
  ): Promise<NormalizedSpan[]> {
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
        const spans: NormalizedSpan[] = [];
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

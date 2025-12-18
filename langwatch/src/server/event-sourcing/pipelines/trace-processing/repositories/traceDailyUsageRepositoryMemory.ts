import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { ProjectDailyUsage } from "@prisma/client";
import type { TraceDailyUsageRepository } from "./traceDailyUsageRepository";

/**
 * In-memory implementation of TraceDailyUsageRepository for testing.
 * Maintains deduplication state in memory.
 */
export class TraceDailyUsageRepositoryMemory implements TraceDailyUsageRepository {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.trace-daily-usage-repository-memory"
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-daily-usage-repository-memory"
  );

  private usageRecords = new Map<string, ProjectDailyUsage>();
  private processedTraces = new Set<string>();

  private getUsageKey(tenantId: string, date: Date): string {
    return `${tenantId}:${date.toISOString().split('T')[0]}`;
  }

  private getProcessedKey(tenantId: string, traceId: string, date: Date): string {
    return `${tenantId}:${traceId}:${date.toISOString().split('T')[0]}`;
  }

  async ensureTraceCounted(
    tenantId: string,
    traceId: string,
    date: Date,
  ): Promise<boolean> {
    return await this.tracer.withActiveSpan(
      "TraceDailyUsageRepositoryMemory.ensureTraceCounted",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceId,
          "date": date.toISOString().split('T')[0],
        },
      },
      async (span) => {
        const processedKey = this.getProcessedKey(tenantId, traceId, date);

        if (this.processedTraces.has(processedKey)) {
          span.setAttributes({ "trace.already_counted": true });
          return false;
        }

        // Mark as processed
        this.processedTraces.add(processedKey);

        // Increment usage
        const usageKey = this.getUsageKey(tenantId, date);
        const existing = this.usageRecords.get(usageKey);

        if (existing) {
          existing.traceCount += 1;
          existing.updatedAt = new Date();
        } else {
          this.usageRecords.set(usageKey, {
            id: usageKey,
            projectId: tenantId,
            date,
            traceCount: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as ProjectDailyUsage);
        }

        span.setAttributes({ "trace.counted": true });
        return true;
      }
    );
  }

  async getUsage(tenantId: string, date: Date) {
    const usageKey = this.getUsageKey(tenantId, date);
    return this.usageRecords.get(usageKey) || null;
  }
}

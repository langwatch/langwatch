import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import { prisma } from "~/server/db";
import type { TraceDailyUsageRepository } from "./traceDailyUsageRepository";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Postgres implementation of TraceDailyUsageRepository.
 * Uses atomic upsert operations for high-performance idempotent counting.
 */
export class TraceDailyUsageRepositoryPostgres implements TraceDailyUsageRepository {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.trace-daily-usage-repository"
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-daily-usage-repository"
  );

  async ensureTraceCounted(
    tenantId: string,
    traceId: string,
    date: Date,
  ): Promise<boolean> {
    return await this.tracer.withActiveSpan(
      "TraceDailyUsageRepositoryPostgres.ensureTraceCounted",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceId,
          "date": date.toISOString().split('T')[0],
        },
      },
      async (span) => {
        try {
          // Single atomic transaction handles everything
          const result = await prisma.$transaction(async (tx) => {
            // Try to insert the processed trace record
            // This will fail with unique constraint if already exists
            try {
              await tx.projectDailyUsageProcessedAggregates.create({
                data: {
                  id: generate(KSUID_RESOURCES.PROJECT_USAGE_PROCESSED).toString(),
                  projectId: tenantId,
                  aggregateId: traceId,
                  date,
                },
              });

              // If we get here, this is the first time processing this trace
              // Increment the daily count
              await tx.projectDailyUsage.upsert({
                where: {
                  projectId_date: {
                    projectId: tenantId,
                    date,
                  },
                },
                update: {
                  traceCount: {
                    increment: 1,
                  },
                  updatedAt: new Date(),
                },
                create: {
                  id: generate(KSUID_RESOURCES.PROJECT_USAGE).toString(),
                  projectId: tenantId,
                  date,
                  traceCount: 1,
                },
              });

              span.setAttributes({ "trace.counted": true });
              return true;

            } catch (error: any) {
              if (error.code === 'P2002') {
                span.setAttributes({ "trace.already_counted": true });
                return false;
              }
              throw error;
            }
          });

          this.logger.debug(
            {
              tenantId,
              traceId,
              date: date.toISOString().split('T')[0],
              wasCounted: result,
            },
            "Ensured trace counted for daily usage"
          );

          return result;
        } catch (error) {
          this.logger.error(
            {
              tenantId,
              traceId,
              date: date.toISOString().split('T')[0],
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to ensure trace counted"
          );
          throw error;
        }
      }
    );
  }

  async getUsage(tenantId: string, date: Date) {
    return await this.tracer.withActiveSpan(
      "TraceDailyUsageRepositoryPostgres.getUsage",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "date": date.toISOString().split('T')[0],
        },
      },
      async () => {
        return await prisma.projectDailyUsage.findUnique({
          where: {
            projectId_date: {
              projectId: tenantId,
              date,
            },
          },
        });
      }
    );
  }
}

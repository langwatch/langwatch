import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import { prisma } from "~/server/db";
import type { TraceDailyUsageRepository } from "./traceDailyUsageRepository";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import { startOfDay, formatISO } from "date-fns";

/**
 * Postgres implementation of TraceDailyUsageRepository.
 * Uses atomic upsert operations for high-performance idempotent counting.
 */
export class TraceDailyUsageRepositoryPostgres
  implements TraceDailyUsageRepository
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.trace-daily-usage-repository",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-daily-usage-repository",
  );

  async ensureTraceCounted(
    tenantId: string,
    traceId: string,
    date: Date,
  ): Promise<boolean> {
    const dateStartOfDay = formatISO(startOfDay(date));
    return await this.tracer.withActiveSpan(
      "TraceDailyUsageRepositoryPostgres.ensureTraceCounted",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceId,
          date: dateStartOfDay,
        },
      },
      async (span) => {
        try {
          const result = await prisma.$transaction(async (tx) => {
            // Try to record that we've processed this (projectId, aggregateId, date).
            // Use createMany + skipDuplicates so duplicates don't throw (keeps logs clean).
            const inserted =
              await tx.projectDailyUsageProcessedAggregates.createMany({
                data: [
                  {
                    id: generate(
                      KSUID_RESOURCES.PROJECT_USAGE_PROCESSED,
                    ).toString(),
                    projectId: tenantId,
                    aggregateId: traceId,
                    date: dateStartOfDay,
                  },
                ],
                skipDuplicates: true,
              });

            // If count is 0, the unique row already existed => trace already counted.
            if (inserted.count === 0) {
              span.setAttributes({ "trace.already_counted": true });
              return false;
            }

            // First time processing this trace for the day: increment the daily count.
            await tx.projectDailyUsage.upsert({
              where: {
                projectId_date: {
                  projectId: tenantId,
                  date: dateStartOfDay,
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
                date: dateStartOfDay,
                traceCount: 1,
              },
            });

            span.setAttributes({ "trace.counted": true });
            return true;
          });

          this.logger.debug(
            {
              tenantId,
              traceId,
              date: dateStartOfDay,
              wasCounted: result,
            },
            "Ensured trace counted for daily usage",
          );

          return result;
        } catch (error) {
          this.logger.error(
            {
              tenantId,
              traceId,
              date: dateStartOfDay,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to ensure trace counted",
          );
          throw error;
        }
      },
    );
  }

  async getUsage(tenantId: string, date: Date) {
    const dateStartOfDay = formatISO(startOfDay(date));

    return await this.tracer.withActiveSpan(
      "TraceDailyUsageRepositoryPostgres.getUsage",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          date: dateStartOfDay,
        },
      },
      async () => {
        return await prisma.projectDailyUsage.findUnique({
          where: {
            projectId_date: {
              projectId: tenantId,
              date: dateStartOfDay,
            },
          },
        });
      },
    );
  }
}

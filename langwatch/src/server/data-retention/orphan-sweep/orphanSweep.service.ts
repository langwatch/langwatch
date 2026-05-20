import type { PrismaClient } from "@prisma/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import { incrementOrphansSswept } from "~/server/metrics";

const logger = createLogger("langwatch:data-retention:orphan-sweep");

const BATCH_SIZE = 1000;

export class OrphanSweepService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly resolveClickHouseClient: ClickHouseClientResolver | null,
  ) {}

  async filterOrphanedTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<{ existing: string[]; orphaned: string[] }> {
    if (!this.resolveClickHouseClient || traceIds.length === 0) {
      return { existing: traceIds, orphaned: [] };
    }

    try {
      const client = await this.resolveClickHouseClient(projectId);
      const result = await client.query({
        query: `
          SELECT DISTINCT TraceId
          FROM trace_summaries FINAL
          WHERE TenantId = {tenantId:String} AND TraceId IN {traceIds:Array(String)}
        `,
        query_params: { tenantId: projectId, traceIds },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{ TraceId: string }>;
      const existingSet = new Set(rows.map((r) => r.TraceId));

      const existing = traceIds.filter((id) => existingSet.has(id));
      const orphaned = traceIds.filter((id) => !existingSet.has(id));

      return { existing, orphaned };
    } catch (error) {
      logger.warn({ projectId, error }, "CH unavailable during orphan check, returning all as existing");
      return { existing: traceIds, orphaned: [] };
    }
  }

  async cleanupOrphans({
    projectId,
    orphanedTraceIds,
  }: {
    projectId: string;
    orphanedTraceIds: string[];
  }): Promise<void> {
    if (orphanedTraceIds.length === 0) return;

    const batches: string[][] = [];
    for (let i = 0; i < orphanedTraceIds.length; i += BATCH_SIZE) {
      batches.push(orphanedTraceIds.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      await this.cleanupBatch({ projectId, traceIds: batch });
    }
  }

  private async cleanupBatch({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<void> {
    const results = await Promise.allSettled([
      this.prisma.annotation
        .deleteMany({
          where: { projectId, traceId: { in: traceIds } },
        })
        .then((r) => {
          if (r.count > 0) incrementOrphansSswept("Annotation", r.count);
        }),

      this.prisma.annotationQueueItem
        .deleteMany({
          where: { projectId, traceId: { in: traceIds } },
        })
        .then((r) => {
          if (r.count > 0) incrementOrphansSswept("AnnotationQueueItem", r.count);
        }),

      this.prisma.publicShare
        .deleteMany({
          where: {
            projectId,
            resourceType: "TRACE",
            resourceId: { in: traceIds },
          },
        })
        .then((r) => {
          if (r.count > 0) incrementOrphansSswept("PublicShare", r.count);
        }),

      this.prisma.triggerSent
        .updateMany({
          where: { projectId, traceId: { in: traceIds } },
          data: { traceId: null },
        })
        .then((r) => {
          if (r.count > 0) incrementOrphansSswept("TriggerSent", r.count);
        }),

      this.prisma.pinnedTrace
        .deleteMany({
          where: { projectId, traceId: { in: traceIds } },
        })
        .then((r) => {
          if (r.count > 0) incrementOrphansSswept("PinnedTrace", r.count);
        }),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        logger.error(
          { projectId, error: result.reason },
          "Failed to clean orphaned PG record",
        );
      }
    }
  }
}

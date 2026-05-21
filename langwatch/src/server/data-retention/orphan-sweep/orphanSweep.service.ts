import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import { incrementOrphansSswept } from "~/server/metrics";
import type { OrphanSweepRepository } from "./orphanSweep.repository";

const logger = createLogger("langwatch:data-retention:orphan-sweep");

const BATCH_SIZE = 1000;

export class OrphanSweepService {
  constructor(
    private readonly repository: OrphanSweepRepository,
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
          SELECT TraceId
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
    const ops: Array<{ model: string; fn: () => Promise<number> }> = [
      { model: "Annotation", fn: () => this.repository.deleteAnnotations({ projectId, traceIds }) },
      { model: "AnnotationQueueItem", fn: () => this.repository.deleteAnnotationQueueItems({ projectId, traceIds }) },
      { model: "PublicShare", fn: () => this.repository.deletePublicShares({ projectId, traceIds }) },
      { model: "TriggerSent", fn: () => this.repository.nullifyTriggerSentTraceIds({ projectId, traceIds }) },
      { model: "PinnedTrace", fn: () => this.repository.deletePinnedTraces({ projectId, traceIds }) },
    ];

    const results = await Promise.allSettled(
      ops.map(async ({ model, fn }) => {
        const count = await fn();
        if (count > 0) incrementOrphansSswept(model, count);
      }),
    );

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

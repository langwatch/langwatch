import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { incrementOrphansSwept } from "~/server/metrics";
import { createLogger } from "~/utils/logger/server";
import type {
  OrphanCandidateCursor,
  OrphanSweepRepository,
} from "./orphanSweep.repository";
import {
  InMemoryOrphanCursorStore,
  type OrphanCursorStore,
} from "./orphanSweepCursor.store";

const logger = createLogger("langwatch:data-retention:orphan-sweep");

const BATCH_SIZE = 1000;
const CANDIDATE_LIMIT = 1000;

// Safety bound on how many candidate pages one sweep walks. Cursoring is now
// persisted across runs (see `cursorStore`), so a project with more
// referencing rows than this resumes from where the previous sweep stopped
// rather than restarting at the beginning and starving the tail.
const MAX_SWEEP_PAGES = 100;

export class OrphanSweepService {
  private readonly cursorStore: OrphanCursorStore;

  constructor(
    private readonly repository: OrphanSweepRepository,
    private readonly resolveClickHouseClient: ClickHouseClientResolver | null,
    cursorStore?: OrphanCursorStore,
  ) {
    this.cursorStore = cursorStore ?? new InMemoryOrphanCursorStore();
  }

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
      // This is purely an existence check: which of `traceIds` have at least one
      // row in trace_summaries. trace_summaries is ReplacingMergeTree(UpdatedAt)
      // with no soft-delete column, so FINAL only collapses duplicate versions —
      // it never makes a TraceId appear or disappear. But FINAL forces a
      // cross-partition replacing-merge (buffering merge state across every
      // weekly partition that holds the tenant's data); run thousands of times a
      // day by the sweep across many projects concurrently, that collectively
      // exhausted the server memory limit (MEMORY_LIMIT_EXCEEDED in prod). The
      // merge is pointless for an existence check, so drop FINAL and dedup the
      // key with DISTINCT: the (TenantId, TraceId) sort key lets this read just
      // the TraceId column for the matched keys, with no merge state.
      const result = await client.query({
        query: `
          SELECT DISTINCT TraceId
          FROM trace_summaries
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
      logger.warn(
        { projectId, error },
        "CH unavailable during orphan check, returning all as existing",
      );
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

  async sweepProject({ projectId }: { projectId: string }): Promise<void> {
    // Resume from the previous sweep's cursor when one is saved. Without
    // persistence, a project with > MAX_SWEEP_PAGES × CANDIDATE_LIMIT live
    // referencing rows would restart at page 0 every hour and never reach
    // any orphan past that prefix.
    let cursor: OrphanCandidateCursor | undefined =
      await this.cursorStore.load(projectId);

    for (let page = 0; page < MAX_SWEEP_PAGES; page++) {
      const { traceIds, nextCursor } =
        await this.repository.findCandidateTraceIds({
          projectId,
          limit: CANDIDATE_LIMIT,
          cursor,
        });

      if (traceIds.length > 0) {
        const { orphaned } = await this.filterOrphanedTraceIds({
          projectId,
          traceIds,
        });
        await this.cleanupOrphans({ projectId, orphanedTraceIds: orphaned });
      }

      // null cursor = every source drained; we've walked the whole project.
      if (!nextCursor) {
        await this.cursorStore.clear(projectId);
        return;
      }
      cursor = nextCursor;
    }

    // Cap hit but more candidates exist. Persist the cursor so the next
    // sweep advances from here instead of restarting.
    if (cursor) {
      await this.cursorStore.save(projectId, cursor);
    }
    logger.warn(
      { projectId, maxPages: MAX_SWEEP_PAGES, pageSize: CANDIDATE_LIMIT },
      "Orphan sweep hit the per-run page cap; next sweep will resume from the saved cursor",
    );
  }

  /**
   * Sweep a batch of projects in sequence. Used by the scheduled cron so
   * tenants that have stopped ingesting still get their dangling PG rows
   * cleaned — the reactor only fires on new TraceProcessingEvents, so
   * without a scheduled pass an inactive tenant accrues stale annotations,
   * shares and pins forever.
   *
   * Failures are isolated per-project so one stuck tenant doesn't block
   * the rest of the batch.
   */
  async sweepProjects({
    projectIds,
  }: {
    projectIds: string[];
  }): Promise<{ swept: number; failed: number }> {
    let swept = 0;
    let failed = 0;
    for (const projectId of projectIds) {
      try {
        await this.sweepProject({ projectId });
        swept++;
      } catch (error) {
        failed++;
        logger.error(
          { projectId, error },
          "Scheduled orphan sweep failed for project; continuing with remaining projects",
        );
      }
    }
    return { swept, failed };
  }

  private async cleanupBatch({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<void> {
    const ops: Array<{ model: string; fn: () => Promise<number> }> = [
      {
        model: "Annotation",
        fn: () => this.repository.deleteAnnotations({ projectId, traceIds }),
      },
      {
        model: "AnnotationQueueItem",
        fn: () =>
          this.repository.deleteAnnotationQueueItems({ projectId, traceIds }),
      },
      {
        model: "PublicShare",
        fn: () => this.repository.deletePublicShares({ projectId, traceIds }),
      },
      {
        model: "TriggerSent",
        fn: () =>
          this.repository.nullifyTriggerSentTraceIds({ projectId, traceIds }),
      },
      {
        model: "PinnedTrace",
        fn: () => this.repository.deletePinnedTraces({ projectId, traceIds }),
      },
    ];

    const results = await Promise.allSettled(
      ops.map(async ({ model, fn }) => {
        const count = await fn();
        if (count > 0) incrementOrphansSwept(model, count);
      }),
    );

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    for (const failure of failures) {
      logger.error(
        { projectId, error: failure.reason },
        "Failed to clean orphaned PG record",
      );
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Failed to clean orphaned PG records",
      );
    }
  }
}

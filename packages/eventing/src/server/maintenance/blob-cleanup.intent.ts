import type { BlobSweepReport } from "@langwatch/group-queue/operational";
import { createLogger } from "@langwatch/observability";
import { BLOB_CLEANUP_PROCESS_NAME, BLOB_CLEANUP_ROW_RETENTION_MS } from "./blob-cleanup.process";

const logger = createLogger("langwatch:group-queue:blob-cleanup");

export interface BlobCleanupDeps {
  /** Runs one full pass over the blob keyspace. */
  sweep: () => Promise<BlobSweepReport>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

/**
 * The sweep's external work, kept out of the process definition so the
 * definition stays pure and synchronous. Redelivery is safe: the sweep is a
 * scan that reclaims only blobs no queue still references, so a second pass
 * over the same keyspace reclaims nothing a first pass already took.
 */
export function runBlobCleanup(deps: BlobCleanupDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const report = await deps.sweep();

    if (report.totals.reclaimed > 0 || report.totals.repaired > 0) {
      logger.info(
        {
          scanned: report.totals.scanned,
          repaired: report.totals.repaired,
          reclaimed: report.totals.reclaimed,
          bookkeeping: report.totals.bookkeeping,
          durationMs: report.durationMs,
        },
        "Blob cleanup sweep reclaimed unreferenced blobs",
      );
    }
    // Partial coverage looks exactly like full coverage in the totals, so it
    // gets its own line rather than a field nobody filters. The next tick
    // resumes from this one's cursor, so this is progress reporting on a
    // keyspace bigger than one tick's ceiling, not a failure.
    if (report.totals.truncated) {
      logger.info(
        { scanned: report.totals.scanned },
        "Blob cleanup hit its per-queue scan ceiling; resuming from this cursor next tick",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: BLOB_CLEANUP_PROCESS_NAME,
        before: startedAt - BLOB_CLEANUP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Blob cleanup outbox retention failed",
      );
    }
  };
}

import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import type { BlobSweepReport } from "@langwatch/group-queue/operational";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:group-queue:blob-cleanup");

export const BLOB_CLEANUP_PROCESS_NAME = "blobCleanup" as const;

/**
 * Outbox rows this process writes are pure bookkeeping (one per tick), so they
 * are pruned on the same schedule every other recurring process uses. Without
 * this the table grows one row per tick forever.
 */
const CLEANUP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const blobCleanupSchema = z.object({ scheduledFor: z.number().int() });

export interface BlobCleanupState {
  lastSweepAt: number | null;
}

export interface BlobCleanupDeps {
  /** Runs one full pass over the blob keyspace. */
  sweep: () => Promise<BlobSweepReport>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type BlobCleanupIntents = {
  sweep: IntentSpec<typeof blobCleanupSchema>;
};

/**
 * Wake handlers must be pure and synchronous — no I/O, no clock reads — because
 * the commit that persists this evolution is what fences racing workers. The
 * sweep itself is an intent, so it runs behind the outbox lease instead.
 */
export const blobCleanupWake: WakeHandler<
  BlobCleanupState,
  BlobCleanupIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

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
        before: startedAt - CLEANUP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Blob cleanup outbox retention failed",
      );
    }
  };
}

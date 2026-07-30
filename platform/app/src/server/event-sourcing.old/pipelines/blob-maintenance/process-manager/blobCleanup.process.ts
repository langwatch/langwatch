import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { Event } from "~/server/event-sourcing.old/domain/types";
import type { ProcessManagerApplier } from "~/server/event-sourcing.old/pipeline/processBuilder";
import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import { BLOB_SWEEP_INTERVAL_MS } from "~/server/event-sourcing.old/queues/groupQueue/blobConstants";
import type { BlobSweepReport } from "~/server/event-sourcing.old/queues/groupQueue/blobSweeper";

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
    // A sweep that never finishes the keyspace looks exactly like a healthy one
    // in the totals, so it gets its own line rather than a field nobody filters.
    if (report.totals.truncated) {
      logger.warn(
        { scanned: report.totals.scanned },
        "Blob cleanup hit its per-queue scan ceiling; keyspace not fully covered this tick",
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

/**
 * The `blobCleanup` process-manager topology, exported standalone so the
 * pipeline mounts one expression of it and tests can build the exact definition
 * the runtime runs. `blob-maintenance/pipeline.ts` mounts it as
 * `.withProcessManager(BLOB_CLEANUP_PROCESS_NAME, blobCleanupPM(deps.cleanup))`.
 */
export function blobCleanupPM(
  deps: BlobCleanupDeps,
): ProcessManagerApplier<Event> {
  return (pm) =>
    pm
      .state<BlobCleanupState>({ lastSweepAt: null })
      .schedule({ everyMs: BLOB_SWEEP_INTERVAL_MS })
      .onWake(blobCleanupWake)
      .intent("sweep", blobCleanupSchema, runBlobCleanup(deps))
      // A full keyspace pass is minutes of work in the worst case, so the
      // lease has to outlast it or a second worker re-leases mid-sweep and
      // both walk the same keys.
      .outbox({ leaseDurationMs: 15 * 60 * 1000, maxAttempts: 3 });
}

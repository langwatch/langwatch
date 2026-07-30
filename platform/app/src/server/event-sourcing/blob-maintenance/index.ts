/**
 * The blob-maintenance pipeline (ADR-098, ADR-100, ADR-102).
 *
 * @see specs/event-sourcing/blob-cleanup-sweep.feature
 *
 * A blob in the job-payload spool is reclaimable once every job leasing it
 * completes (ADR-100 decision 6). A worker that dies mid-flight never releases
 * its lease, so this scheduled sweep is the only thing that reclaims what it
 * held.
 */

import type { Metrics } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { type ScheduledTickMount, scheduledTick } from "../scheduledTick";

const logger = createLogger("langwatch:blob-maintenance:cleanup");

export const BLOB_CLEANUP_NAME = "blobCleanup" as const;

export const BLOB_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** One sweep pass's outcome. `leased` and `pending` are deliberately absent:
 *  "nothing to do this tick" drives no decision here. */
export interface BlobSweepOutcome {
  /** Blobs the sweep looked at, across every outcome including `failed`. */
  readonly scanned: number;
  readonly reclaimed: number;
  readonly repaired: number;
  readonly bookkeeping: number;
  /** The per-queue scan ceiling stopped the walk before the keyspace ended. */
  readonly truncated: boolean;
  /** Blobs the sweep could not evaluate — an errored script call, a key that
   *  failed to parse. */
  readonly failed: number;
}

export interface BlobCleanupDeps {
  /** One full pass over the blob keyspace. */
  readonly sweep: () => Promise<BlobSweepOutcome>;
  /** Records that this tick ran, exactly once per tick. */
  readonly recordTick: () => Promise<void>;
  readonly metrics?: Metrics;
  readonly now?: () => number;
}

export type BlobCleanupMount = ScheduledTickMount<typeof BLOB_CLEANUP_NAME>;

export function createBlobCleanupMount(
  deps: BlobCleanupDeps,
): BlobCleanupMount {
  const now = deps.now ?? Date.now;

  return scheduledTick({
    name: BLOB_CLEANUP_NAME,
    intervalMs: BLOB_CLEANUP_INTERVAL_MS,
    metrics: deps.metrics,
    metricPrefix: "es_blob_cleanup",
    recordTick: deps.recordTick,
    work: async () => {
      const startedAt = now();
      const outcome = await deps.sweep();

      if (outcome.reclaimed > 0 || outcome.repaired > 0) {
        logger.info(
          {
            scanned: outcome.scanned,
            repaired: outcome.repaired,
            reclaimed: outcome.reclaimed,
            bookkeeping: outcome.bookkeeping,
            durationMs: now() - startedAt,
          },
          "blob cleanup sweep reclaimed unreferenced blobs",
        );
      }
      // A truncated sweep looks exactly like a healthy one in the
      // reclaim/repair totals, so it gets its own line.
      if (outcome.truncated) {
        logger.warn(
          { scanned: outcome.scanned },
          "blob cleanup hit its per-queue scan ceiling; keyspace not fully covered this tick",
        );
      }
      if (outcome.failed > 0) {
        logger.error(
          { scanned: outcome.scanned, failed: outcome.failed },
          "blob cleanup sweep left blobs unevaluated; the next scheduled tick retries them",
        );
      }

      return {
        succeeded: outcome.scanned - outcome.failed,
        failed: outcome.failed,
        failure:
          outcome.failed > 0
            ? new Error(
                `blob cleanup sweep failed to evaluate ${outcome.failed} of ${outcome.scanned} blobs`,
              )
            : undefined,
      };
    },
  });
}

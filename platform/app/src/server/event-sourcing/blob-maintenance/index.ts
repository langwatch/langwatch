/**
 * The blob-maintenance pipeline (ADR-098, ADR-100, ADR-102).
 *
 * @see specs/event-sourcing/blob-cleanup-sweep.feature
 *
 * A blob in the job-payload spool is reclaimable once every job leasing it
 * completes (ADR-100 decision 6). A worker that dies mid-flight never releases
 * its lease, so this scheduled sweep is the only thing that reclaims what it
 * held. No aggregate, no events, no lane: this is queue infrastructure.
 */

import { type Metrics, noopMetrics } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:blob-maintenance:cleanup");

export const BLOB_CLEANUP_NAME = "blobCleanup" as const;

export const BLOB_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** One sweep tick's outcome. `leased` and `pending` are deliberately absent:
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

/**
 * The scheduled sweep (ADR-098): reclaims blobs nothing references, on a fixed
 * clock, independent of any pipeline's event stream.
 *
 * The sweep's own failure is raised so the whole tick retries (a reclaimed blob
 * stays reclaimed, so a retry costs one wasted scan); `recordTick`'s failure is
 * swallowed and logged. Per-blob failure counting depends on `sweep` populating
 * `failed`, which today's sweeper does not do.
 */
export function runBlobCleanup(deps: BlobCleanupDeps) {
  const metrics = deps.metrics ?? noopMetrics;
  const candidates = metrics.counter({
    name: "es_blob_cleanup_candidates_total",
    help: "Blobs the blob-cleanup sweep examined, by outcome.",
    labelNames: ["outcome"],
  });

  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    let outcome: BlobSweepOutcome | undefined;
    let failure: Error | undefined;

    try {
      outcome = await deps.sweep();
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      // The sweep never returned a report, so there is no candidate set to
      // attribute this against — it counts as one failed tick.
      candidates.inc({ outcome: "failure" });
      logger.error(
        { error: failure.message },
        "blob cleanup sweep failed; the next scheduled tick retries it",
      );
    }

    if (outcome) {
      const succeeded = outcome.scanned - outcome.failed;
      if (succeeded > 0) candidates.inc({ outcome: "success" }, succeeded);
      if (outcome.failed > 0) {
        candidates.inc({ outcome: "failure" }, outcome.failed);
        failure = new Error(
          `blob cleanup sweep failed to evaluate ${outcome.failed} of ${outcome.scanned} blobs`,
        );
        logger.error(
          { scanned: outcome.scanned, failed: outcome.failed },
          "blob cleanup sweep left blobs unevaluated; the next scheduled tick retries them",
        );
      }
      if (outcome.reclaimed > 0 || outcome.repaired > 0) {
        logger.info(
          {
            scanned: outcome.scanned,
            repaired: outcome.repaired,
            reclaimed: outcome.reclaimed,
            bookkeeping: outcome.bookkeeping,
            durationMs: (deps.now ?? Date.now)() - startedAt,
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
    }

    // Recorded either way: this tick happened, and a run of failing ticks must
    // not also lose its own bookkeeping.
    try {
      await deps.recordTick();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "blob cleanup tick bookkeeping failed",
      );
    }

    // Raised so whatever schedules this tick retries the whole thing.
    if (failure) throw failure;
  };
}

/** How the sweep is mounted: run `run()` every `intervalMs`, retry a thrown
 *  tick. */
export interface BlobCleanupMount {
  readonly name: typeof BLOB_CLEANUP_NAME;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
}

export function createBlobCleanupMount(
  deps: BlobCleanupDeps,
): BlobCleanupMount {
  return {
    name: BLOB_CLEANUP_NAME,
    intervalMs: BLOB_CLEANUP_INTERVAL_MS,
    run: runBlobCleanup(deps),
  };
}

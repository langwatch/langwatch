/**
 * The blob-maintenance pipeline (ADR-098, ADR-100, ADR-102), rewritten onto
 * `@langwatch/event-sourcing` from
 * `event-sourcing.old/pipelines/blob-maintenance/` (read-only reference for
 * this rewrite; this is a rewrite of behaviour, not a port of code).
 *
 * @see specs/event-sourcing/blob-cleanup-sweep.feature — the contract.
 *
 * ## What this pipeline does
 *
 * GroupQueue2's job-payload spool holds an oversized job's staged payload as
 * a content-addressed blob, reclaimable once every job holding a lease on it
 * completes (ADR-100 decision 6). A worker that dies mid-flight never
 * releases its lease, so this scheduled sweep is the only thing that
 * reclaims what it was holding: on a fixed interval it walks every
 * registered queue's blob keyspace and reclaims blobs no lease still
 * references, past their grace window.
 *
 * This is queue-infrastructure maintenance, not a domain pipeline, which is
 * why it carries no aggregate, no events and no commands, and dispatches
 * nothing through the event log — `withAggregateType("global")` in the old
 * pipeline was taxonomy for exactly this: a sweep with nothing to append.
 *
 * ## A significant, deliberate gap: no mounting runtime exists yet
 *
 * Same gap `billing-reporting/index.ts` documents in full:
 * `@langwatch/event-sourcing`'s `src/index.ts` exports `defineAggregate`,
 * the fold and map executors, the store contracts, the dispatch-plane
 * group-key descriptor/renderer and the schema compiler — it does not
 * export, and does not yet implement, a scheduler or a process-manager
 * runtime. This pipeline is narrower than billing-reporting's: it is
 * schedule-only, with nothing corresponding to a per-event poke, so
 * `createBlobCleanupMount` below returns the same plain
 * `{ name, intervalMs, run }` descriptor `billingMeterSweep.ts` does, for
 * the same likely future home
 * (`~/server/app-layer/scheduler/scheduler.service.ts`, outside this
 * pipeline's directory, not wired here). No `GroupKey` is declared for the
 * same reason billing's poke and sweep declare none: nothing here dispatches
 * through the group-keyed queue (ADR-100) yet, and inventing a lane for a
 * dispatch that does not happen would be a mechanism nobody asked for.
 *
 * ## The failure doctrine (audit finding this rewrite fixes)
 *
 * `event-sourcing.old` had two defects in this area, both corrected here:
 *
 *   1. Five sibling sweeps — including this one and `langySessionKeyReap`'s
 *      — swallowed a failed outbox-retention prune identically (catch, log,
 *      continue, no counter). That mechanism does not carry forward: there
 *      is no outbox table in the new architecture for this rewrite to bound
 *      the size of, so `recordTick` replaces it as a narrow bookkeeping hook
 *      (mirrors `billing-reporting/reporting/billingMeterSweep.ts`'s
 *      `recordTick`), and it keeps the SAME swallow-and-log doctrine as the
 *      old retention prune — losing today's bookkeeping is recoverable at
 *      the next tick, losing today's actual sweep result to a bookkeeping
 *      error would not be.
 *   2. Those same five siblings disagreed on the MAIN work's own doctrine:
 *      `graphAlertSweep` logged a candidate failure and moved on forever;
 *      `billingMeterSweep` raised so the whole tick retried. This rewrite
 *      picks ONE doctrine and applies it identically to both
 *      `blob-maintenance` and `langy-maintenance`: raise on failure,
 *      mirroring `billingMeterSweep` (the accepted reference shape). Both
 *      sweeps are naturally idempotent — a blob already reclaimed stays
 *      reclaimed, a session key already revoked stays revoked — so a full
 *      retry costs one wasted scan, never a double effect. Every outcome,
 *      success or failure, is counted on
 *      `es_blob_cleanup_candidates_total{outcome}`, so a tick that fails
 *      every candidate cannot report success silently the way
 *      `event-sourcing.old`'s `BlobSweeper.sweepQueue` did (its per-key
 *      `catch` logged and continued with no counter at all).
 *
 * KNOWN GAP: per-blob failure counting depends on the `sweep` port
 * populating `BlobSweepOutcome.failed`, which `event-sourcing.old`'s
 * `BlobSweeper` (read-only reference, unmodified by this rewrite) does not
 * do today — its per-key catch has nothing to report into. Until whoever
 * ports it forward wires a real count in, this pipeline can still detect a
 * sweep that fails OUTRIGHT (the `sweep()` call itself throwing), but not
 * one that silently drops individual blobs. Flagged rather than guessed at.
 */

import { type Metrics, noopMetrics } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:blob-maintenance:cleanup");

export const BLOB_CLEANUP_NAME = "blobCleanup" as const;

/** Five minutes — matches `event-sourcing.old`'s `BLOB_SWEEP_INTERVAL_MS`. */
export const BLOB_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * One sweep tick's outcome. Deliberately narrower than
 * `event-sourcing.old`'s `BlobSweepReport`: `leased` and `pending` are
 * "nothing to do this tick" outcomes the old pipeline never logged either,
 * so they add no decision this rewrite needs to make.
 */
export interface BlobSweepOutcome {
  /** Blobs the sweep looked at, across every outcome including `failed`. */
  readonly scanned: number;
  readonly reclaimed: number;
  readonly repaired: number;
  readonly bookkeeping: number;
  /** The per-queue scan ceiling stopped the walk before the keyspace ended. */
  readonly truncated: boolean;
  /**
   * Blobs the sweep could not evaluate — a Lua-script call that errored, a
   * key that failed to parse. See this file's module docblock for why this
   * field exists and its known gap.
   */
  readonly failed: number;
}

export interface BlobCleanupDeps {
  /** One full pass over the blob keyspace. */
  readonly sweep: () => Promise<BlobSweepOutcome>;
  /**
   * Records that this tick ran, exactly once per tick. Deliberately narrow —
   * see `billing-reporting/reporting/billingMeterSweep.ts`'s `recordTick`
   * docblock for why this replaces the old outbox-retention prune rather
   * than reproducing it.
   */
  readonly recordTick: () => Promise<void>;
  readonly metrics?: Metrics;
  readonly now?: () => number;
}

/**
 * The scheduled sweep (ADR-098): reclaims blobs nothing references, on a
 * fixed clock, independent of any pipeline's event stream. See this file's
 * module docblock for the failure doctrine.
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
      // A sweep that never finishes the keyspace looks exactly like a
      // healthy one in the reclaim/repair totals, so it gets its own line
      // rather than a field nobody filters.
      if (outcome.truncated) {
        logger.warn(
          { scanned: outcome.scanned },
          "blob cleanup hit its per-queue scan ceiling; keyspace not fully covered this tick",
        );
      }
    }

    // Recorded either way: this tick happened, and a run of failing ticks
    // must not also lose its own bookkeeping (mirrors billingMeterSweep).
    try {
      await deps.recordTick();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "blob cleanup tick bookkeeping failed",
      );
    }

    // Raised, not logged-and-forgotten: whatever schedules this tick must
    // retry the whole thing. Retrying is free — a blob already reclaimed
    // stays reclaimed, so re-sweeping costs one wasted scan, never a double
    // effect.
    if (failure) throw failure;
  };
}

/**
 * Describes how the sweep must be mounted, for a future scheduler — no
 * process-manager/scheduler runtime exists in `@langwatch/event-sourcing`
 * yet (see this file's module docblock).
 */
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

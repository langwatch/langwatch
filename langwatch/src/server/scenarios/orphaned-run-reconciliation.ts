/**
 * Orphaned-run reconciliation.
 *
 * The scenario execution pool is in-process and per worker pod — it holds no
 * cross-process record of which run a worker is executing. When a worker dies
 * mid-run (OOM, crash, deploy, container restart) the in-process failure
 * handler that would emit a terminal `finished` event dies with it, so the run
 * is left non-terminal in ClickHouse forever: the UI spins at "Starting"/
 * "Running" and downstream reactors (suite aggregates, metrics) never fire.
 * Read-time stall detection paints it as STALLED cosmetically but never writes
 * a terminal event, so the run never actually leaves the in-flight state.
 *
 * Every scenarios worker reconciles orphaned runs when it boots: it asks for
 * non-terminal runs whose last activity is older than any live worker could
 * still be holding them, and emits a terminal failure event (reusing the same
 * idempotent finish path as in-process child failures) so they go terminal for
 * good and the downstream reactors run.
 *
 * @see specs/scenarios/orphaned-run-reconciliation.feature
 * @see https://github.com/langwatch/langwatch/issues/3195
 */

import { createLogger } from "~/utils/logger/server";
import { STALL_THRESHOLD_MS } from "./stall-detection";

const logger = createLogger("langwatch:scenarios:orphan-reconciliation");

/**
 * A run is only reconciled once its last activity is older than the longest a
 * live worker could still legitimately be holding it. We reuse the read-path's
 * stall threshold (2× the child-process timeout): a worker hard-caps every
 * child at the timeout and emits its own terminal event at the cap, so a
 * non-terminal run quiet for longer than the stall threshold provably has no
 * live worker. Filtering at the same boundary the read-path already calls
 * STALLED keeps the write-path consistent and leaves margin past the hard cap
 * for clock skew and buffered-but-imminent queued jobs — reconciling a run a
 * live pod still owns is the one outcome we must never produce.
 */
export const ORPHAN_RECONCILE_THRESHOLD_MS = STALL_THRESHOLD_MS;

/** Error surfaced on a reconciled run so the cause is attributable in the UI. */
export const ORPHAN_ERROR_MESSAGE =
  "Worker restarted or crashed before the run completed";

/**
 * Minimal shape of an orphaned run — only the ids needed to emit its terminal
 * failure event. Carries TenantId because the boot sweep is cross-tenant; the
 * terminal write is then scoped per-run to that tenant.
 */
export interface OrphanedRun {
  tenantId: string;
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  scenarioSetId: string;
  status: string;
}

/** Surfaces non-terminal runs whose worker has gone away. */
export interface OrphanedRunFinder {
  findOrphanedRuns(params: {
    now: number;
    thresholdMs: number;
  }): Promise<OrphanedRun[]>;
}

/**
 * Emits the terminal failure event for an orphaned run. Structurally satisfied
 * by `ScenarioFailureHandler` — reconciliation reuses the exact path that
 * in-process child crashes/timeouts already use, so an orphan becomes a real
 * `finished(ERROR)` event (idempotent) and the downstream reactors run.
 */
export interface OrphanFailureEmitter {
  ensureFailureEventsEmitted(params: {
    projectId: string;
    scenarioId: string;
    setId: string;
    batchRunId: string;
    scenarioRunId: string;
    error: string;
  }): Promise<void>;
}

/**
 * Reconciles every orphaned run the finder surfaces to a terminal error state.
 *
 * Each run is reconciled independently — one failing emit does not abort the
 * rest. The finish command is idempotent, so co-booting pods (or the owning
 * worker's own timeout racing this sweep) collapse to a single terminal event.
 */
export async function reconcileOrphanedRuns({
  finder,
  failureEmitter,
  now = Date.now(),
  thresholdMs = ORPHAN_RECONCILE_THRESHOLD_MS,
}: {
  finder: OrphanedRunFinder;
  failureEmitter: OrphanFailureEmitter;
  now?: number;
  thresholdMs?: number;
}): Promise<{ reconciled: number; failed: number }> {
  const orphans = await finder.findOrphanedRuns({ now, thresholdMs });

  if (orphans.length === 0) {
    return { reconciled: 0, failed: 0 };
  }

  logger.info(
    { count: orphans.length, thresholdMs },
    "Reconciling orphaned scenario runs on worker boot",
  );

  const results = await Promise.allSettled(
    orphans.map((run) =>
      failureEmitter.ensureFailureEventsEmitted({
        projectId: run.tenantId,
        scenarioId: run.scenarioId,
        setId: run.scenarioSetId,
        batchRunId: run.batchRunId,
        scenarioRunId: run.scenarioRunId,
        error: ORPHAN_ERROR_MESSAGE,
      }),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  const reconciled = results.length - failed;

  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      logger.error(
        { scenarioRunId: orphans[i]?.scenarioRunId, err: result.reason },
        "Failed to reconcile orphaned scenario run",
      );
    }
  }

  logger.info({ reconciled, failed }, "Orphaned scenario runs reconciled");
  return { reconciled, failed };
}

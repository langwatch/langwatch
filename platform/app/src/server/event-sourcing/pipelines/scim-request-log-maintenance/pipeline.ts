import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  runScimRequestLogRetention,
  SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS,
  SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
  type ScimRequestLogRetentionDeps,
  type ScimRequestLogRetentionState,
  scimRequestLogRetentionSchema,
  scimRequestLogRetentionWake,
} from "./process-manager/scimRequestLogRetentionSweep.process";

export interface ScimRequestLogMaintenancePipelineDeps {
  logRetention: ScimRequestLogRetentionDeps;
}

/**
 * The sweep that drops recorded SCIM requests once they age out (ADR-126 —
 * see specs/identity/scim-request-log.feature), in its own pipeline for the
 * same reason every other identity maintenance sweep is in theirs: pruning a
 * request log belongs to neither the request path nor the queue.
 *
 * THIS IS WHY THE TABLE IS NOT AN EVENT LOG. An event log has no retention;
 * operational evidence does. A missed tick costs nothing but a few extra rows
 * kept a few hours longer — nothing downstream derives from them, which is
 * the property that makes deleting them safe at all, including safe on any
 * retry the outbox gives this sweep.
 *
 * SAFE TO RETRY without qualification: `sweepExpired` deletes by id in
 * batches and stops once a batch comes back short, so re-running it after a
 * partial failure just finds fewer rows still older than the window and
 * deletes those — a delete that already ran costs the retry nothing but a
 * wasted read. Sized like blob-maintenance's lease rather than the lighter
 * reaps': the backlog it clears is "large and lumpy" by the service's own
 * comment (an outage, or the first sweep once thirty days accrue), so the
 * loop over 5,000-row batches can run long.
 *
 * UNDER THE OLD MECHANISM the first tick ran a minute after boot rather than
 * at it, for the same reason its `breakGlassExpiryWorker` neighbour did. A
 * scheduled process manager has no equivalent of an immediate first tick to
 * guard against in the first place: a freshly armed schedule's first wake
 * fires only a full interval (six hours) after boot, already more
 * conservative than the minute the old worker waited.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createScimRequestLogMaintenancePipeline(
  deps: ScimRequestLogMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("scim_request_log_maintenance")
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME, (pm) =>
        pm
          .state<ScimRequestLogRetentionState>({ lastSweepAt: null })
          .schedule({ everyMs: SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS })
          .onWake(scimRequestLogRetentionWake)
          .intent(
            "sweep",
            scimRequestLogRetentionSchema,
            runScimRequestLogRetention(deps.logRetention),
          )
          // An unbounded loop over 5,000-row batches on a backlog the
          // service's own comment calls "large and lumpy"; the same lease
          // blob-maintenance takes for the same reason.
          .outbox({ leaseDurationMs: 15 * 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}

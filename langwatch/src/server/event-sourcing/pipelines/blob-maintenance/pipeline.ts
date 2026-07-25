import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import { BLOB_SWEEP_INTERVAL_MS } from "../../queues/groupQueue/blobConstants";
import {
  BLOB_CLEANUP_PROCESS_NAME,
  type BlobCleanupDeps,
  type BlobCleanupState,
  blobCleanupSchema,
  blobCleanupWake,
  runBlobCleanup,
} from "./process-manager/blobCleanup.process";

export interface BlobMaintenancePipelineDeps {
  cleanup: BlobCleanupDeps;
}

/**
 * Queue-infrastructure maintenance, kept in its own pipeline rather than bolted
 * onto a domain one: reclaiming blobs is not an automations or trace concern,
 * and mounting it where it does not belong is how ownership blurs.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 *
 * Exactly-once per tick is inherited, not implemented here: the wake commits at
 * the revision it was scheduled at, so when several workers race the same tick
 * one commit wins and the losers stand down. There is deliberately no Redis
 * leader lock.
 */
export function createBlobMaintenancePipeline(deps: BlobMaintenancePipelineDeps) {
  return definePipeline<Event>()
    .withName("blob_maintenance")
    // `global` rather than a new taxonomy entry: aggregate types are a
    // ClickHouse partition key, and this pipeline appends no events, so minting
    // an identifier that can never appear in the event store would be taxonomy
    // debt for nothing. The sweep is genuinely global — it belongs to the queue,
    // not to a tenant.
    .withAggregateType("global")
    .withProcessManager(BLOB_CLEANUP_PROCESS_NAME, (pm) =>
      pm
        .state<BlobCleanupState>({ lastSweepAt: null })
        .schedule({ everyMs: BLOB_SWEEP_INTERVAL_MS })
        .onWake(blobCleanupWake)
        .intent("sweep", blobCleanupSchema, runBlobCleanup(deps.cleanup))
        // A full keyspace pass is minutes of work in the worst case, so the
        // lease has to outlast it or a second worker re-leases mid-sweep and
        // both walk the same keys.
        .outbox({ leaseDurationMs: 15 * 60 * 1000, maxAttempts: 3 }),
    )
    .build();
}

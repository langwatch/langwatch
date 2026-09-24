import { BLOB_SWEEP_INTERVAL_MS } from "@langwatch/group-queue/operational";

import { defineAggregate } from "../../domain/definitions.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { type BlobCleanupDeps, runBlobCleanup } from "./blob-cleanup.intent.ts";
import {
  BLOB_CLEANUP_INITIAL_STATE,
  BLOB_CLEANUP_PROCESS_NAME,
  type BlobCleanupState,
  blobCleanupSchema,
  blobCleanupWake,
} from "./blob-cleanup.process.ts";

export interface BlobMaintenancePipelineDeps {
  cleanup: BlobCleanupDeps;
}

/**
 * Isolated blob-reclamation maintenance with no domain events or commands.
 * Exactly-once is inherited: only the worker with the tick's winning commit proceeds.
 */
export function createBlobMaintenancePipeline(deps: BlobMaintenancePipelineDeps) {
  return definePipeline({
    name: "blob_maintenance",
    aggregate: defineAggregate({
      // `global` rather than a new taxonomy entry: aggregate types are a
      // ClickHouse partition key, and this pipeline appends no events, so minting
      // an identifier that can never appear in the event store would be taxonomy
      // debt for nothing. The sweep is genuinely global — it belongs to the queue,
      // not to a tenant.
      type: "global",
    }),
  })
    .withEvents([])
    .withProcessManager(BLOB_CLEANUP_PROCESS_NAME, (pm) =>
      pm
        .state<BlobCleanupState>(BLOB_CLEANUP_INITIAL_STATE)
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

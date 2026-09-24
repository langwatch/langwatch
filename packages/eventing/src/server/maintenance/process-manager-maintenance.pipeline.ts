import { defineAggregate } from "../../domain/definitions.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import {
  type ProcessRetentionSweepDeps,
  runProcessRetentionSweep,
} from "./process-retention-sweep.intent.ts";
import {
  PROCESS_RETENTION_SWEEP_INITIAL_STATE,
  PROCESS_RETENTION_SWEEP_INTERVAL_MS,
  PROCESS_RETENTION_SWEEP_LEASE_MS,
  PROCESS_RETENTION_SWEEP_PROCESS_NAME,
  type ProcessRetentionSweepState,
  processRetentionSweepSchema,
  processRetentionSweepWake,
} from "./process-retention-sweep.process.ts";

export interface ProcessManagerMaintenancePipelineDeps {
  retentionSweep: ProcessRetentionSweepDeps;
}

/**
 * Isolated process-manager retention: reaps inbox/outbox across all processes
 * by predicate, covering both registered and future processes without opt-in.
 */
export function createProcessManagerMaintenancePipeline(
  deps: ProcessManagerMaintenancePipelineDeps,
) {
  return definePipeline({
    name: "process_manager_maintenance",
    aggregate: defineAggregate({
      // `global`, like blob_maintenance and langy_maintenance: this pipeline
      // appends no events, so minting an aggregate type that can never appear
      // in the event store would be taxonomy debt for nothing. The sweep spans
      // every tenant by design.
      type: "global",
    }),
  })
    .withEvents([])
    .withProcessManager(PROCESS_RETENTION_SWEEP_PROCESS_NAME, (pm) =>
      pm
        .state<ProcessRetentionSweepState>(PROCESS_RETENTION_SWEEP_INITIAL_STATE)
        .schedule({ everyMs: PROCESS_RETENTION_SWEEP_INTERVAL_MS })
        .onWake(processRetentionSweepWake)
        .intent("sweep", processRetentionSweepSchema, runProcessRetentionSweep(deps.retentionSweep))
        // The sweep stops itself at RETENTION_SWEEP_DEADLINE_MS, which sits
        // well inside this lease, so a slow run leaves work for the next tick
        // rather than letting the lease lapse and a second worker start a
        // concurrent sweep.
        .outbox({
          leaseDurationMs: PROCESS_RETENTION_SWEEP_LEASE_MS,
          maxAttempts: 3,
        }),
    )
    .build();
}

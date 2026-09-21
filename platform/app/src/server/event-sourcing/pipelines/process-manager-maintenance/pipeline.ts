import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  PROCESS_RETENTION_SWEEP_INTERVAL_MS,
  PROCESS_RETENTION_SWEEP_LEASE_MS,
  PROCESS_RETENTION_SWEEP_PROCESS_NAME,
  type ProcessRetentionSweepDeps,
  type ProcessRetentionSweepState,
  processRetentionSweepSchema,
  processRetentionSweepWake,
  runProcessRetentionSweep,
} from "./process-manager/processRetentionSweep.process";

export interface ProcessManagerMaintenancePipelineDeps {
  retentionSweep: ProcessRetentionSweepDeps;
}

/**
 * Retention for the process-manager substrate's own tables, in its own
 * pipeline for the same reason blob_maintenance and langy_maintenance are:
 * reaping the inbox and outbox belongs to no single domain, and hanging it off
 * one domain's schedule is how it ends up covering only that domain.
 *
 * WHICH IS EXACTLY WHAT HAPPENED. Retention used to be per-process opt-in:
 * each process manager that cared called `deleteDispatchedBefore` with its own
 * name from its own wake. Six of twelve process names never did, the inbox had
 * no deletion path at all, and the highest-volume process manager got its
 * retention by piggybacking on an unrelated pipeline's daily prune — where an
 * unguarded await meant a failure in that prune silently took the retention
 * with it. Production reached 2.8M inbox rows and 473k outbox rows in twenty
 * days on a database with storage autoscaling off.
 *
 * This sweep reaps by PREDICATE across every processName instead, so it covers
 * the processes nobody registered and every process added later, with no
 * registration step to forget. Per-process self-prunes are left in place as
 * harmless backstops; they now delete rows this would have deleted anyway.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 *
 * Exactly-once per tick is inherited, not implemented here: the wake commits at
 * the revision it was scheduled at, so when several workers race the same tick
 * one commit wins and the losers stand down.
 */
export function createProcessManagerMaintenancePipeline(
  deps: ProcessManagerMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("process_manager_maintenance")
      // `global`, like blob_maintenance and langy_maintenance: this pipeline
      // appends no events, so minting an aggregate type that can never appear
      // in the event store would be taxonomy debt for nothing. The sweep spans
      // every tenant by design.
      .withAggregateType("global")
      .withProcessManager(PROCESS_RETENTION_SWEEP_PROCESS_NAME, (pm) =>
        pm
          .state<ProcessRetentionSweepState>({
            lastSweepAt: null,
            sweepsScheduled: 0,
          })
          .schedule({ everyMs: PROCESS_RETENTION_SWEEP_INTERVAL_MS })
          .onWake(processRetentionSweepWake)
          .intent(
            "sweep",
            processRetentionSweepSchema,
            runProcessRetentionSweep(deps.retentionSweep),
          )
          // The sweep stops itself at RETENTION_SWEEP_DEADLINE_MS, which sits
          // well inside this lease, so a slow run leaves work for the next tick
          // rather than letting the lease lapse and a second worker start a
          // concurrent sweep.
          .outbox({
            leaseDurationMs: PROCESS_RETENTION_SWEEP_LEASE_MS,
            maxAttempts: 3,
          }),
      )
      .build()
  );
}

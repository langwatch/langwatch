import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  ORPHAN_LINK_SWEEP_INITIAL_STATE,
  ORPHAN_LINK_SWEEP_INTERVAL_MS,
  ORPHAN_LINK_SWEEP_PROCESS_NAME,
  type OrphanLinkSweepDeps,
  type OrphanLinkSweepState,
  orphanLinkSweepSchema,
  orphanLinkSweepWake,
  runOrphanLinkSweep,
} from "./process-manager/orphanLinkSweep.process";

export interface IdentityLinksMaintenancePipelineDeps {
  orphanSweep: OrphanLinkSweepDeps;
}

/**
 * Usage-attribution link maintenance (ADR-094 Decision 4), in its own pipeline
 * for the same reason langy_maintenance is in its own: reconciling who a
 * provider login belonged to is neither a conversation concern nor a queue
 * concern.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 *
 * Exactly-once per tick is inherited, not implemented here: the wake commits
 * at the revision it was scheduled at, so when several workers race the same
 * tick one commit wins and the losers stand down.
 */
export function createIdentityLinksMaintenancePipeline(
  deps: IdentityLinksMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("identity_links_maintenance")
      // `global`, like the other maintenance pipelines: this appends no
      // events, and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(ORPHAN_LINK_SWEEP_PROCESS_NAME, (pm) =>
        pm
          .state<OrphanLinkSweepState>(ORPHAN_LINK_SWEEP_INITIAL_STATE)
          .schedule({ everyMs: ORPHAN_LINK_SWEEP_INTERVAL_MS })
          .onWake(orphanLinkSweepWake)
          .intent(
            "sweep",
            orphanLinkSweepSchema,
            runOrphanLinkSweep(deps.orphanSweep),
          )
          // One indexed anti-join capped at a batch, then at most a handful of
          // small transactions — but the FIRST tick after deploy may still
          // carry whatever the pre-hook offboarding paths left open, so the
          // lease is sized for that pass rather than the steady state.
          .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}

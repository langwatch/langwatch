import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  type LangySessionKeyReapDeps,
  langySessionKeyReapPM,
} from "./process-manager/langySessionKeyReap.process";

export interface LangyMaintenancePipelineDeps {
  sessionKeyReap: LangySessionKeyReapDeps;
}

/**
 * Langy credential maintenance, in its own pipeline for the same reason
 * blob_maintenance is in its own: reaping orphaned session keys is neither a
 * conversation concern nor a queue concern, and mounting a sweep where it does
 * not belong is how ownership blurs.
 *
 * WHY THIS EXISTS AT ALL: the reaper was written, tested and routed for cron,
 * and then never scheduled — the chart ships `cronjobs.jobs: {}` on purpose,
 * because every first-party sweep moved onto this worker path. So the backstop
 * its own docstring calls "THE GUARANTEE" had no caller. That cron route is now
 * deleted rather than left as a second way in. (It also threw on every invocation until the
 * tenancy guard learned that a reserved key name is platform-owned; the two
 * defects hid each other, since nothing was calling the endpoint that 500s.)
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 *
 * Exactly-once per tick is inherited, not implemented here: the wake commits at
 * the revision it was scheduled at, so when several workers race the same tick
 * one commit wins and the losers stand down.
 */
export function createLangyMaintenancePipeline(
  deps: LangyMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("langy_maintenance")
      // `global`, like blob_maintenance: this pipeline appends no events, so
      // minting an aggregate type that can never appear in the event store would
      // be taxonomy debt for nothing. The sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(
        LANGY_SESSION_KEY_REAP_PROCESS_NAME,
        langySessionKeyReapPM(deps.sessionKeyReap),
      )
      .build()
  );
}

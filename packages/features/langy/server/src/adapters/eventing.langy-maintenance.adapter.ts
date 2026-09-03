import { defineAggregate, defineEvents, definePipeline, type Event } from "@langwatch/eventing";
import {
  type LangySessionKeyReapDeps,
  runLangySessionKeyReap,
} from "../intents/langy-session-key-reap.intent";
import {
  LANGY_SESSION_KEY_REAP_INTERVAL_MS,
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  type LangySessionKeyReapState,
  langySessionKeyReapSchema,
  langySessionKeyReapWake,
} from "../processes/langy-session-key-reap.process";

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
export class EventingLangyMaintenanceAdapter {
  static create(deps: LangyMaintenancePipelineDeps): EventingLangyMaintenanceAdapter {
    return new EventingLangyMaintenanceAdapter(deps);
  }

  private constructor(private readonly deps: LangyMaintenancePipelineDeps) {}

  buildProcessing() {
    const sessionKeyReap = this.deps.sessionKeyReap;
    return definePipeline<Event>({
      name: "langy_maintenance",
      aggregate: defineAggregate({
        // `global`, like blob_maintenance: this pipeline appends no events, so
        // minting an aggregate type that can never appear in the event store would
        // be taxonomy debt for nothing. The sweep spans every tenant by design.
        type: "global",
        events: defineEvents([]),
      }),
    })
      .withProcessManager(LANGY_SESSION_KEY_REAP_PROCESS_NAME, (pm) =>
        pm
          .state<LangySessionKeyReapState>({ lastReapAt: null })
          .schedule({ everyMs: LANGY_SESSION_KEY_REAP_INTERVAL_MS })
          .onWake(langySessionKeyReapWake)
          .intent("reap", langySessionKeyReapSchema, runLangySessionKeyReap(sessionKeyReap))
          // One bounded UPDATE over the (name, revokedAt, expiresAt) index added
          // in 20260728120000 — nothing like the blob sweep's keyspace walk, so
          // the default-ish lease is ample. NOTE the FIRST tick after deploy also
          // clears the historical backlog of keys this reaper never reached while
          // it was rejected by the tenancy guard, so that one runs long.
          .outbox({ leaseDurationMs: 60 * 1000, maxAttempts: 3 }),
      )
      .build();
  }
}

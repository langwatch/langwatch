import {
  defineAggregate,
  definePipeline,
  type StaticPipelineDefinition,
  type Event,
} from "@langwatch/eventing";

import {
  type LangySessionKeyReapDeps,
  runLangySessionKeyReap,
} from "../eventing/langy-session-key-reap.intent.ts";
import {
  LANGY_SESSION_KEY_REAP_INTERVAL_MS,
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  type LangySessionKeyReapState,
  langySessionKeyReapSchema,
  langySessionKeyReapWake,
} from "../eventing/langy-session-key-reap.process.ts";

export interface LangyMaintenancePipelineDeps {
  sessionKeyReap: LangySessionKeyReapDeps;
}

/** Langy credential maintenance in its own pipeline (like blob_maintenance): reaping orphaned
 * session keys is neither a conversation nor queue concern. No events, no commands—costs only the
 * scheduled wake. Exactly-once per tick inherited: wake commits at scheduled revision. */
export class LangyMaintenanceService {
  static create(deps: LangyMaintenancePipelineDeps): LangyMaintenanceService {
    return new LangyMaintenanceService(deps);
  }

  private constructor(private readonly deps: LangyMaintenancePipelineDeps) {}

  buildProcessing(): StaticPipelineDefinition<Event> {
    const sessionKeyReap = this.deps.sessionKeyReap;
    return definePipeline({
      name: "langy_maintenance",
      aggregate: defineAggregate({
        // `global`, like blob_maintenance: this pipeline appends no events, so
        // minting an aggregate type that can never appear in the event store would
        // be taxonomy debt for nothing. The sweep spans every tenant by design.
        type: "global",
      }),
    })
      .withEvents([])
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

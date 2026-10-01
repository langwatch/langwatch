import {
  defineAggregate,
  definePipeline,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  PROJECT_CREATED_EVENT_TYPE,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";

import {
  type LangySessionKeyReapDeps,
  runLangySessionKeyReap,
} from "../eventing/langy-session-key-reap.intent.ts";
import {
  LANGY_SESSION_KEY_REAP_INTERVAL_MS,
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  langySessionKeyReapStateSchema,
  langySessionKeyReapSchema,
  langySessionKeyReapWake,
} from "../eventing/langy-session-key-reap.process.ts";
import type { LangyVirtualKeyProvisioningService } from "./langy-virtual-key-provisioning.service.ts";

export interface LangyMaintenancePipelineDeps {
  sessionKeyReap: LangySessionKeyReapDeps;
  virtualKeyProvisioning: Pick<LangyVirtualKeyProvisioningService, "provisionCreated">;
}

/** Langy credential maintenance in its own pipeline (like blob_maintenance): reaping orphaned
 * session keys and minting a new project's key are neither a conversation nor queue concern. No
 * events, no commands. Exactly-once per tick inherited: wake commits at scheduled revision. */
export class LangyMaintenanceService {
  static create(deps: LangyMaintenancePipelineDeps): LangyMaintenanceService {
    return new LangyMaintenanceService(deps);
  }

  private constructor(private readonly deps: LangyMaintenancePipelineDeps) {}

  buildProcessing(): StaticPipelineDefinition<never> {
    const { sessionKeyReap, virtualKeyProvisioning } = this.deps;
    return (
      definePipeline({
        name: "langy_maintenance",
        aggregate: defineAggregate({
          // `global`, like blob_maintenance: this pipeline appends no events, so
          // minting an aggregate type that can never appear in the event store would
          // be taxonomy debt for nothing. The sweep spans every tenant by design.
          type: "global",
        }),
      })
        .withEvents([])
        // Project records a created project; langy mints its key from its own side (§9).
        .withPeerSubscriber("provisionProjectVirtualKey", {
          eventType: PROJECT_CREATED_EVENT_TYPE,
          data: projectCreatedEventDataSchema,
          handle: (created) => virtualKeyProvisioning.provisionCreated(created),
        })
        .withProcessManager(LANGY_SESSION_KEY_REAP_PROCESS_NAME, (pm) =>
          pm
            .state(langySessionKeyReapStateSchema, { lastReapAt: null })
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
        .build()
    );
  }
}

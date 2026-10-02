/**
 * Langy's own maintenance sweep (ADR-144): hourly revocation of elapsed
 * session keys and a new project's key, no events and no commands of its own.
 * Ported from the deleted `LangyMaintenanceWorkerFeatureInstaller`.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  PROJECT_CREATED_EVENT_TYPE,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";

import type { LangyModule } from "../app/langy.app.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import type { LangyVirtualKeyProvisioningService } from "../services/langy-virtual-key-provisioning.service.ts";
import {
  type LangySessionKeyReapDeps,
  runLangySessionKeyReap,
} from "./langy-session-key-reap.intent.ts";
import {
  LANGY_SESSION_KEY_REAP_INTERVAL_MS,
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  langySessionKeyReapStateSchema,
  langySessionKeyReapSchema,
  langySessionKeyReapWake,
} from "./langy-session-key-reap.process.ts";

export interface LangyMaintenancePipelineDeps {
  sessionKeyReap: LangySessionKeyReapDeps;
  virtualKeyProvisioning: Pick<LangyVirtualKeyProvisioningService, "provisionCreated">;
}

/** The pipeline over only what it calls, so a test can build it without an app. */
export function buildLangyMaintenancePipeline({
  sessionKeyReap,
  virtualKeyProvisioning,
}: LangyMaintenancePipelineDeps): StaticPipelineDefinition<never> {
  return (
    definePipeline({
      name: "langy_maintenance",
      // `global`, like blob_maintenance: no events appended, so no aggregate type to mint.
      aggregate: defineAggregate({ type: "global" }),
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
          // One bounded UPDATE over the (name, revokedAt, expiresAt) index; the
          // first tick after deploy clears the historical backlog, so runs long.
          .outbox({ leaseDurationMs: 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}

export const langyMaintenanceEventing = defineEventingModule({
  pipeline: "langy_maintenance",
  build: ({ app, processStore }: EventingSetup<LangyRepositories, LangyModule>) =>
    app.maintenanceEventingPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});

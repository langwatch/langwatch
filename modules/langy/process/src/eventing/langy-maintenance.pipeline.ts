/**
 * Langy's maintenance pipeline (ADR-144): a new project's virtual key, minted
 * from project's created fact; no events and no commands of its own. Elapsed
 * session keys are retired by api-key's sweep.
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
import type { LangyVirtualKeyProvisioningService } from "../features/session-key/services/langy-virtual-key-provisioning.service.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
interface LangyMaintenancePipelineDeps {
  virtualKeyProvisioning: Pick<LangyVirtualKeyProvisioningService, "provisionCreated">;
}

/** The pipeline over only what it calls, so a test can build it without an app. */
export function buildLangyMaintenancePipeline({
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
      .build()
  );
}

export const langyMaintenanceEventing = defineEventingModule({
  pipeline: "langy_maintenance",
  build: ({ app }: EventingSetup<LangyRepositories, LangyModule>) =>
    app.maintenanceEventingPipeline(),
});

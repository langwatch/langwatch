/**
 * Langy's maintenance pipeline (ADR-144): a new project's virtual key, minted from project's
 * created fact, and a CI follow-up turn from GitHub's finished-checks fact; no events and no
 * commands of its own. Elapsed session keys are retired by api-key's sweep.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  GITHUB_PULL_REQUEST_CHECKS_COMPLETED_EVENT_TYPE,
  githubPullRequestChecksCompletedEventDataSchema,
} from "@langwatch/github-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";

import type { LangyModule } from "../app/langy.app.ts";
import type { LangyCiFollowUpService } from "../features/github/services/langy-ci-follow-up.service.ts";
import type { LangyVirtualKeyProvisioningService } from "../features/session-key/services/langy-virtual-key-provisioning.service.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
interface LangyMaintenancePipelineDeps {
  virtualKeyProvisioning: Pick<LangyVirtualKeyProvisioningService, "provisionCreated">;
  ciFollowUps: Pick<LangyCiFollowUpService, "handleChecksCompleted">;
}

/** The pipeline over only what it calls, so a test can build it without an app. */
export function buildLangyMaintenancePipeline({
  virtualKeyProvisioning,
  ciFollowUps,
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
      // GitHub records that CI finished on a Langy branch; langy wakes the conversation (§9).
      .withPeerSubscriber("langyCiFollowUp", {
        eventType: GITHUB_PULL_REQUEST_CHECKS_COMPLETED_EVENT_TYPE,
        data: githubPullRequestChecksCompletedEventDataSchema,
        handle: (checks) => ciFollowUps.handleChecksCompleted(checks),
      })
      .build()
  );
}

export const langyMaintenanceEventing = defineEventingModule({
  pipeline: "langy_maintenance",
  build: ({ app }: EventingSetup<LangyRepositories, LangyModule>) =>
    app.maintenanceEventingPipeline(),
});

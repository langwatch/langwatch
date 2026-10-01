import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import {
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  personalWorkspaceProvisionedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/project-contract";

import type { ProjectModule } from "../app/project.app.ts";
import type { ProjectRepositories } from "../repositories/project.repositories.ts";
import {
  RecordProjectCreatedCommand,
  RecordProjectLegacyKeyRevokedCommand,
} from "./project-lifecycle.commands.ts";
import {
  projectCreatedEventSchema,
  projectLegacyKeyRevokedEventSchema,
} from "./project-lifecycle.events.ts";

function lifecycleCommands() {
  return definePipeline({
    name: PROJECT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PROJECT_AGGREGATE_TYPE }),
  })
    .withEvents([projectCreatedEventSchema, projectLegacyKeyRevokedEventSchema])
    .withCommand("recordProjectCreated", RecordProjectCreatedCommand)
    .withCommand("recordProjectLegacyKeyRevoked", RecordProjectLegacyKeyRevokedCommand);
}

export type ProjectLifecycleDefinition = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

/**
 * project_lifecycle: project records its facts; peers react from their own side (§9). Organization
 * writes a personal workspace's project row itself, so project records that project as created.
 */
export function buildProjectLifecyclePipeline(deps: {
  recordProjectCreated: (input: { projectId: string; organizationId: string }) => Promise<void>;
}): ProjectLifecycleDefinition {
  return lifecycleCommands()
    .withPeerSubscriber("recordPersonalWorkspaceProject", {
      eventType: PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
      data: personalWorkspaceProvisionedEventDataSchema,
      handle: ({ projectId, organizationId }) =>
        deps.recordProjectCreated({ projectId, organizationId }),
    })
    .build();
}

export const projectLifecycleEventing = defineEventingModule({
  pipeline: PROJECT_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<ProjectRepositories, ProjectModule>) =>
    buildProjectLifecyclePipeline({
      recordProjectCreated: (input) => app.recordProjectCreated(input),
    }),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});

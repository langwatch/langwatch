import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import {
  PERSONAL_WORKSPACE_ARCHIVED_EVENT_TYPE,
  PERSONAL_WORKSPACE_FEATURES_CHANGED_EVENT_TYPE,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  PERSONAL_WORKSPACE_REVIVED_EVENT_TYPE,
  personalWorkspaceArchivedEventDataSchema,
  personalWorkspaceFeaturesChangedEventDataSchema,
  personalWorkspaceProvisionedEventDataSchema,
  personalWorkspaceRevivedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/project-contract";

import type { ProjectModule } from "../app/project.app.ts";
import type { ProjectRepositories } from "../repositories/project.repositories.ts";
import type { PersonalProjectService } from "../services/personal-project.service.ts";
import {
  RecordProjectCreatedCommand,
  RecordProjectLegacyKeyRevokedCommand,
  RecordProjectPresenceSettingChangedCommand,
  RecordProjectMovedCommand,
  RecordProjectArchivedCommand,
  RecordProjectDepartmentAssignedCommand,
  RecordProjectTraceSharingDisabledCommand,
} from "./project-lifecycle.commands.ts";
import {
  projectCreatedEventSchema,
  projectLegacyKeyRevokedEventSchema,
  projectPresenceSettingChangedEventSchema,
  projectMovedEventSchema,
  projectArchivedEventSchema,
  projectDepartmentAssignedEventSchema,
  projectTraceSharingDisabledEventSchema,
} from "./project-lifecycle.events.ts";

function lifecycleCommands() {
  return definePipeline({
    name: PROJECT_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PROJECT_AGGREGATE_TYPE }),
  })
    .withEvents([
      projectCreatedEventSchema,
      projectLegacyKeyRevokedEventSchema,
      projectPresenceSettingChangedEventSchema,
      projectMovedEventSchema,
      projectArchivedEventSchema,
      projectDepartmentAssignedEventSchema,
      projectTraceSharingDisabledEventSchema,
    ])
    .withCommand("recordProjectCreated", RecordProjectCreatedCommand)
    .withCommand("recordProjectLegacyKeyRevoked", RecordProjectLegacyKeyRevokedCommand)
    .withCommand("recordPresenceSettingChanged", RecordProjectPresenceSettingChangedCommand)
    .withCommand("recordProjectMoved", RecordProjectMovedCommand)
    .withCommand("recordProjectArchived", RecordProjectArchivedCommand)
    .withCommand("recordProjectDepartmentAssigned", RecordProjectDepartmentAssignedCommand)
    .withCommand("recordProjectTraceSharingDisabled", RecordProjectTraceSharingDisabledCommand);
}

type ProjectLifecycleDefinition = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

/**
 * project_lifecycle: project records its facts; peers react from their own side (§9). Organization
 * writes a personal workspace's project row itself, so project records that project as created.
 */
export function buildProjectLifecyclePipeline(deps: {
  recordProjectCreated: (input: { projectId: string; organizationId: string }) => Promise<void>;
  personalProjects: Pick<PersonalProjectService, "archive" | "revive" | "setFeatures">;
}): ProjectLifecycleDefinition {
  return lifecycleCommands()
    .withPeerSubscriber("recordPersonalWorkspaceProject", {
      eventType: PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
      data: personalWorkspaceProvisionedEventDataSchema,
      handle: ({ projectId, organizationId }) =>
        deps.recordProjectCreated({ projectId, organizationId }),
    })
    .withPeerSubscriber("archivePersonalWorkspaceProjects", {
      eventType: PERSONAL_WORKSPACE_ARCHIVED_EVENT_TYPE,
      data: personalWorkspaceArchivedEventDataSchema,
      handle: ({ teamIds, occurredAt }) => deps.personalProjects.archive({ teamIds, occurredAt }),
    })
    .withPeerSubscriber("revivePersonalWorkspaceProject", {
      eventType: PERSONAL_WORKSPACE_REVIVED_EVENT_TYPE,
      data: personalWorkspaceRevivedEventDataSchema,
      handle: ({ teamId }) => deps.personalProjects.revive({ teamId }),
    })
    .withPeerSubscriber("setPersonalWorkspaceFeatures", {
      eventType: PERSONAL_WORKSPACE_FEATURES_CHANGED_EVENT_TYPE,
      data: personalWorkspaceFeaturesChangedEventDataSchema,
      handle: ({ projectId, features }) =>
        deps.personalProjects.setFeatures({ projectId, features }),
    })
    .build();
}

export const projectLifecycleEventing = defineEventingModule({
  pipeline: PROJECT_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<ProjectRepositories, ProjectModule>) =>
    buildProjectLifecyclePipeline({
      recordProjectCreated: (input) => app.recordProjectCreated(input),
      personalProjects: app.personalProjects(),
    }),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});

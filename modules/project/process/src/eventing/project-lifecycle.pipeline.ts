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
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  personalWorkspaceArchivedEventDataSchema,
  personalWorkspaceFeaturesChangedEventDataSchema,
  personalWorkspaceProvisionedEventDataSchema,
  personalWorkspaceRevivedEventDataSchema,
  personalTeamCreatedEventDataSchema,
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
  RecordProjectAggregateRuleChangedCommand,
  RecordProjectRevivedCommand,
  RecordProjectDepartmentAssignedCommand,
  RecordProjectTraceSharingDisabledCommand,
} from "./project-lifecycle.commands.ts";
import {
  projectCreatedEventSchema,
  projectLegacyKeyRevokedEventSchema,
  projectPresenceSettingChangedEventSchema,
  projectMovedEventSchema,
  projectArchivedEventSchema,
  projectAggregateRuleChangedEventSchema,
  projectRevivedEventSchema,
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
      projectAggregateRuleChangedEventSchema,
      projectRevivedEventSchema,
    ])
    .withCommand("recordProjectCreated", RecordProjectCreatedCommand)
    .withCommand("recordProjectLegacyKeyRevoked", RecordProjectLegacyKeyRevokedCommand)
    .withCommand("recordPresenceSettingChanged", RecordProjectPresenceSettingChangedCommand)
    .withCommand("recordProjectMoved", RecordProjectMovedCommand)
    .withCommand("recordProjectArchived", RecordProjectArchivedCommand)
    .withCommand("recordProjectDepartmentAssigned", RecordProjectDepartmentAssignedCommand)
    .withCommand("recordProjectTraceSharingDisabled", RecordProjectTraceSharingDisabledCommand)
    .withCommand("recordProjectAggregateRuleChanged", RecordProjectAggregateRuleChangedCommand)
    .withCommand("recordProjectRevived", RecordProjectRevivedCommand);
}

type ProjectLifecycleDefinition = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

/**
 * project_lifecycle: project records its facts; peers react from their own side (§9). Project
 * creates a personal team's project on organization's fact and records the team's real project as
 * created; workspaces provisioned before it are recorded.
 */
export function buildProjectLifecyclePipeline(deps: {
  recordProjectCreated: (input: { projectId: string; organizationId: string }) => Promise<void>;
  personalProjects: Pick<PersonalProjectService, "create" | "archive" | "revive" | "setFeatures">;
}): ProjectLifecycleDefinition {
  return lifecycleCommands()
    .withPeerSubscriber("recordPersonalWorkspaceProject", {
      eventType: PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
      data: personalWorkspaceProvisionedEventDataSchema,
      handle: ({ projectId, organizationId }) =>
        deps.recordProjectCreated({ projectId, organizationId }),
    })
    .withPeerSubscriber("createPersonalWorkspaceProject", {
      eventType: PERSONAL_TEAM_CREATED_EVENT_TYPE,
      data: personalTeamCreatedEventDataSchema,
      handle: async (fact) => {
        const projectId = await deps.personalProjects.create(fact);
        await deps.recordProjectCreated({ projectId, organizationId: fact.organizationId });
      },
    })
    .withPeerSubscriber("archivePersonalWorkspaceProjects", {
      eventType: PERSONAL_WORKSPACE_ARCHIVED_EVENT_TYPE,
      data: personalWorkspaceArchivedEventDataSchema,
      handle: ({ teamIds, occurredAt }) => deps.personalProjects.archive({ teamIds, occurredAt }),
    })
    .withPeerSubscriber("revivePersonalWorkspaceProject", {
      eventType: PERSONAL_WORKSPACE_REVIVED_EVENT_TYPE,
      data: personalWorkspaceRevivedEventDataSchema,
      handle: ({ teamId, organizationId }) =>
        deps.personalProjects.revive({ teamId, organizationId }),
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

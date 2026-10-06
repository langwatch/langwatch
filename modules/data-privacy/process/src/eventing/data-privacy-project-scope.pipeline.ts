/**
 * Data privacy folds project's lifecycle facts from its own side (§5, §9; Alex, 2026-10-06), so
 * it holds no project peer. Spec: modules/data-privacy/specs/data-privacy-resolution-seam.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  PROJECT_ARCHIVED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE,
  PROJECT_MOVED_EVENT_TYPE,
  projectArchivedEventDataSchema,
  projectCreatedEventDataSchema,
  projectDepartmentAssignedEventDataSchema,
  projectMovedEventDataSchema,
} from "@langwatch/project-contract";

import type { DataPrivacyModule } from "../app/data-privacy.app.ts";
import type { DataPrivacyRepositories } from "../repositories/data-privacy.repositories.ts";
import type { DataPrivacyProjectScopeService } from "../services/data-privacy-project-scope.service.ts";

const DATA_PRIVACY_PROJECT_SCOPE_PIPELINE_NAME = "data_privacy_project_scope" as const;

export type DataPrivacyProjectScopePipeline = StaticPipelineDefinition<never>;

export function buildDataPrivacyProjectScopePipeline({
  scopes,
}: {
  scopes: DataPrivacyProjectScopeService;
}): DataPrivacyProjectScopePipeline {
  return (
    definePipeline({
      name: DATA_PRIVACY_PROJECT_SCOPE_PIPELINE_NAME,
      // `global`: data privacy appends no events of its own; it only folds project's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // Every fold is idempotent and newer-wins, so a redelivered or late fact changes nothing.
      .withPeerSubscriber("dataPrivacyProjectCreated", {
        eventType: PROJECT_CREATED_EVENT_TYPE,
        data: projectCreatedEventDataSchema,
        handle: ({ projectId, organizationId, teamId, isPersonal, occurredAt }) =>
          scopes.projectCreated({
            projectId,
            organizationId,
            occurredAt,
            ...(teamId === undefined ? {} : { teamId }),
            ...(isPersonal === undefined ? {} : { isPersonal }),
          }),
      })
      .withPeerSubscriber("dataPrivacyProjectMoved", {
        eventType: PROJECT_MOVED_EVENT_TYPE,
        data: projectMovedEventDataSchema,
        handle: ({ projectId, organizationId, toTeamId, occurredAt }) =>
          scopes.projectMoved({ projectId, organizationId, toTeamId, occurredAt }),
      })
      .withPeerSubscriber("dataPrivacyProjectDepartmentAssigned", {
        eventType: PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE,
        data: projectDepartmentAssignedEventDataSchema,
        handle: ({ projectId, organizationId, departmentId, teamId, isPersonal, occurredAt }) =>
          scopes.departmentAssigned({
            projectId,
            organizationId,
            departmentId,
            teamId,
            isPersonal,
            occurredAt,
          }),
      })
      .withPeerSubscriber("dataPrivacyProjectArchived", {
        eventType: PROJECT_ARCHIVED_EVENT_TYPE,
        data: projectArchivedEventDataSchema,
        handle: ({ projectId, organizationId, occurredAt }) =>
          scopes.projectArchived({ projectId, organizationId, occurredAt }),
      })
      .build()
  );
}

export const dataPrivacyProjectScopeEventing = defineEventingModule({
  pipeline: DATA_PRIVACY_PROJECT_SCOPE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DataPrivacyRepositories, DataPrivacyModule>) =>
    app.projectScopePipeline(),
});

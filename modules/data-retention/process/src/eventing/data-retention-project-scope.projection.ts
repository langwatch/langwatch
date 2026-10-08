/**
 * Data retention's own copy of where each project sits: a peer fold (§9) over project's lifecycle
 * facts, per project, in order; existing projects arrive by a projection replay (Alex, 2026-10-06,
 * Q151 Q1). Spec: modules/data-retention/specs/data-retention-project-scope.feature
 */
import type { PeerEvent, PeerFoldProjectionDeclaration } from "@langwatch/eventing";
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

import {
  DATA_RETENTION_PROJECT_SCOPE_PROJECTION_VERSION,
  type DataRetentionProjectScopeRepository,
  type DataRetentionProjectScopeState,
} from "../repositories/data-retention-project-scope.repository.ts";

/** The fold's name; its global lane is `<host pipeline>.projectScope`. */
export const DATA_RETENTION_PROJECT_SCOPE_PROJECTION_NAME = "projectScope" as const;

/** Every project fact retention folds, each parsed by project-contract's own schema. */
export const dataRetentionProjectScopePeerEvents = [
  { type: PROJECT_CREATED_EVENT_TYPE, data: projectCreatedEventDataSchema },
  { type: PROJECT_MOVED_EVENT_TYPE, data: projectMovedEventDataSchema },
  { type: PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE, data: projectDepartmentAssignedEventDataSchema },
  { type: PROJECT_ARCHIVED_EVENT_TYPE, data: projectArchivedEventDataSchema },
] as const;

export type DataRetentionProjectScopePeerEvent = PeerEvent<
  typeof dataRetentionProjectScopePeerEvents
>;

/** One fact over the project's row: the team keeps its newest naming fact; late ones are inert. */
export function foldDataRetentionProjectScope(
  state: DataRetentionProjectScopeState,
  event: DataRetentionProjectScopePeerEvent,
): DataRetentionProjectScopeState {
  const occurredAt = event.occurredAt;
  let teamId: string | undefined;
  if (event.type === PROJECT_MOVED_EVENT_TYPE) teamId = event.data.toTeamId;
  else if (event.type !== PROJECT_ARCHIVED_EVENT_TYPE) teamId = event.data.teamId;
  const newerTeam =
    teamId !== undefined && (state.teamRecordedAt === null || occurredAt >= state.teamRecordedAt);
  const archived = event.type === PROJECT_ARCHIVED_EVENT_TYPE;
  return {
    projectId: event.data.projectId,
    organizationId: event.data.organizationId,
    teamId: newerTeam ? (teamId ?? state.teamId) : state.teamId,
    teamRecordedAt: newerTeam ? occurredAt : state.teamRecordedAt,
    archivedAt: archived ? Math.max(state.archivedAt ?? 0, occurredAt) : state.archivedAt,
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, occurredAt),
  };
}

/** The peer fold data retention hosts on its own pipeline, over its own store. */
export function dataRetentionProjectScopePeerFold(
  store: DataRetentionProjectScopeRepository,
): PeerFoldProjectionDeclaration<
  DataRetentionProjectScopeState,
  typeof dataRetentionProjectScopePeerEvents
> {
  return {
    events: dataRetentionProjectScopePeerEvents,
    fold: {
      name: DATA_RETENTION_PROJECT_SCOPE_PROJECTION_NAME,
      version: DATA_RETENTION_PROJECT_SCOPE_PROJECTION_VERSION,
      eventTypes: dataRetentionProjectScopePeerEvents.map(({ type }) => type),
      init: () => ({
        projectId: "",
        organizationId: "",
        teamId: null,
        teamRecordedAt: null,
        archivedAt: null,
        LastEventOccurredAt: 0,
      }),
      apply: foldDataRetentionProjectScope,
      store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
    },
  };
}

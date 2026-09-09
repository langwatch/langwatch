import type { ProjectApi } from "@langwatch/project-contract";
import {
  PostgresProjectAdapter,
  type PostgresProjectAdapterOptions,
} from "@langwatch/project-server";
import { toDate } from "@langwatch/time";

/**
 * A `ProjectApi` over real rows, for the suites that seed a project and then
 * exercise another feature's doors against it.
 *
 * The module's own directory answers every read; the three operations that
 * belong to the project application's cross-entity half refuse by name,
 * because nothing composed here is behind them.
 */
export function createPrismaProjectApi(options: PostgresProjectAdapterOptions): ProjectApi {
  const directory = PostgresProjectAdapter.create(options).build();
  const unimplemented = (operation: string): Promise<never> =>
    Promise.reject(new Error(`this suite composes no project application: ${operation}`));

  return {
    listPaths: (input) => directory.listPaths(input),
    tryGetOrganizationId: (projectId) => directory.tryGetOrganizationId(projectId),
    isPresenceEnabled: (input) => directory.isPresenceEnabled(input),
    tryGetSummaryById: (projectId) => directory.tryGetSummaryById(projectId),
    searchByQuery: (input) => directory.searchByQuery(input),
    tryGetById: (id) => directory.tryGetById(id),
    getOrganizationId: (projectId) => directory.getOrganizationId(projectId),
    getWithTeam: (id) => directory.getWithTeam(id),
    tryGetWithTeam: (id) => directory.tryGetWithTeam(id),
    listByOrganization: (input) => directory.listByOrganization(input),
    listByTeam: (input) => directory.listByTeam(input),
    listNamesByIds: (input) => directory.listNamesByIds(input),
    listIdsByOrganization: (input) => directory.listIdsByOrganization(input),
    create: (input, by) => directory.create({ ...input, userId: by.id }),
    updateSettings: () => unimplemented("updateSettings"),
    archive: () => unimplemented("archive"),
    regenerateLegacyProjectKey: () => unimplemented("regenerateLegacyProjectKey"),
    findIdByLegacyApiKey: (input) => directory.findIdByLegacyApiKey(input),
    rotateLegacyApiKey: (input) => directory.rotateLegacyApiKey(input),
    findTraceSharingConfig: (input) => directory.findTraceSharingConfig(input.projectId),
    findPersonalWorkspaceOwner: (input) => directory.findPersonalWorkspaceOwner(input),
    requestTopicClustering: () => unimplemented("requestTopicClustering"),
    touchCodingAgentPullRequestSeen: (input) =>
      directory.touchCodingAgentPullRequestSeen({ projectId: input.projectId, at: toDate(input.at) }),
    touchCodingAgentSessionSeen: (input) =>
      directory.touchCodingAgentSessionSeen({ projectId: input.projectId, at: toDate(input.at) }),
    findInternal: (input) => directory.findInternal(input),
    ensureInternal: (input) => directory.ensureInternal(input),
    findIdentity: (id) => directory.findIdentity(id),
    listActiveByScopes: (input) => directory.listActiveByScopes(input),
    updateMetadata: (input) => directory.updateMetadata(input),
    resolveOrgAdmin: (projectId) => directory.resolveOrgAdmin(projectId),
    resolveTraceDestination: (input) => directory.resolveTraceDestination(input),
    findTraceDestination: (projectId) => directory.findTraceDestination(projectId),
    listTraceDestinations: (projectIds) => directory.listTraceDestinations(projectIds),
  };
}

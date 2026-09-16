import type { ProjectApi } from "@langwatch/project-contract";
import {
  PrismaProjectRepository,
  ProjectService,
  type ProjectCredentials,
  type ProjectDiagnostics,
  type ProjectKeyMap,
  type ProjectStoredObjects,
  type PrismaProjectDatabase,
} from "@langwatch/project-server";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { toDate } from "@langwatch/time";

export interface PostgresProjectAdapterOptions {
  database: PrismaProjectDatabase;
  credentials: ProjectCredentials;
  organizations: OrganizationApi;
  keyMap?: ProjectKeyMap;
  storedObjects?: ProjectStoredObjects;
  diagnostics?: ProjectDiagnostics;
}

/**
 * A `ProjectApi` over real rows, for suites that seed a project and then
 * exercise another feature's doors. The module's directory answers every
 * read; the cross-entity operations refuse by name — nothing here backs them.
 */
export function createPrismaProjectApi(options: PostgresProjectAdapterOptions): ProjectApi {
  const directory = ProjectService.create({
    repository: PrismaProjectRepository.create({ prisma: options.database }),
    credentials: options.credentials,
    organizations: options.organizations,
    keyMap: options.keyMap,
    storedObjects: options.storedObjects,
    diagnostics: options.diagnostics,
  });
  const unimplemented = (operation: string): Promise<never> =>
    Promise.reject(new Error(`this suite composes no project application: ${operation}`));

  return {
    listPaths: (input) => directory.listPaths(input),
    findOrganizationId: (projectId) => directory.findOrganizationId(projectId),
    isPresenceEnabled: (input) => directory.isPresenceEnabled(input),
    findSummaryById: (projectId) => directory.findSummaryById(projectId),
    searchByQuery: (input) => directory.searchByQuery(input),
    findById: (id) => directory.findById(id),
    getOrganizationId: (projectId) => directory.getOrganizationId(projectId),
    getWithTeam: (id) => directory.getWithTeam(id),
    findWithTeam: (id) => directory.findWithTeam(id),
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

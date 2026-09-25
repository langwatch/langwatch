import type { ProjectApi } from "@langwatch/project-contract";

/**
 * A complete `ProjectApi` fake, so a transport suite stays at the module
 * boundary: the operations a test cares about are overridden, the absences a
 * surface treats as normal answer null, and everything else refuses by name.
 */
export class TestProjectApi implements ProjectApi {
  findProjectsWithDepartments(): ReturnType<ProjectApi["findProjectsWithDepartments"]> {
    throw new Error("TestProjectApi.findProjectsWithDepartments is not configured");
  }

  assignProjectDepartment(): ReturnType<ProjectApi["assignProjectDepartment"]> {
    throw new Error("TestProjectApi.assignProjectDepartment is not configured");
  }

  countWithTraces(): Promise<number> {
    return Promise.resolve(0);
  }

  findSharedProjectSlugs(): Promise<string[]> {
    return Promise.resolve([]);
  }

  countUsage(): Promise<{ projects: number; updatedProjects: number }> {
    return Promise.resolve({ projects: 0, updatedProjects: 0 });
  }

  constructor(private readonly overrides: Partial<ProjectApi>) {}

  findOrganizationId: ProjectApi["findOrganizationId"] = (projectId) =>
    this.overrides.findOrganizationId?.(projectId) ?? this.unimplemented("findOrganizationId");

  searchByQuery: ProjectApi["searchByQuery"] = (input) =>
    this.overrides.searchByQuery?.(input) ?? this.unimplemented("searchByQuery");

  listNamesByIds: ProjectApi["listNamesByIds"] = (input) =>
    this.overrides.listNamesByIds?.(input) ?? this.unimplemented("listNamesByIds");

  listIdsByOrganization: ProjectApi["listIdsByOrganization"] = (input) =>
    this.overrides.listIdsByOrganization?.(input) ?? this.unimplemented("listIdsByOrganization");

  findLiveNonGovernanceIdsByOrganization: ProjectApi["findLiveNonGovernanceIdsByOrganization"] = (
    input,
  ) =>
    this.overrides.findLiveNonGovernanceIdsByOrganization?.(input) ??
    this.unimplemented("findLiveNonGovernanceIdsByOrganization");

  findLiveBySlug: ProjectApi["findLiveBySlug"] = (input) =>
    this.overrides.findLiveBySlug?.(input) ?? this.unimplemented("findLiveBySlug");

  findLiveByRef: ProjectApi["findLiveByRef"] = (input) =>
    this.overrides.findLiveByRef?.(input) ?? this.unimplemented("findLiveByRef");

  listPaths: ProjectApi["listPaths"] = (input) =>
    this.overrides.listPaths?.(input) ?? this.unimplemented("listPaths");

  isPresenceEnabled: ProjectApi["isPresenceEnabled"] = (input) =>
    this.overrides.isPresenceEnabled?.(input) ?? Promise.resolve(false);

  findSummaryById: ProjectApi["findSummaryById"] = (projectId) =>
    this.overrides.findSummaryById?.(projectId) ?? Promise.resolve(null);

  findById: ProjectApi["findById"] = (id) => this.overrides.findById?.(id) ?? Promise.resolve(null);

  getOrganizationId: ProjectApi["getOrganizationId"] = (projectId) =>
    this.overrides.getOrganizationId?.(projectId) ?? this.unimplemented("getOrganizationId");

  getWithTeam: ProjectApi["getWithTeam"] = (id) =>
    this.overrides.getWithTeam?.(id) ?? this.unimplemented("getWithTeam");

  findWithTeam: ProjectApi["findWithTeam"] = (id) =>
    this.overrides.findWithTeam?.(id) ?? Promise.resolve(null);

  listByOrganization: ProjectApi["listByOrganization"] = (input) =>
    this.overrides.listByOrganization?.(input) ??
    Promise.resolve({ data: [], pagination: { page: input.page, limit: input.limit, total: 0 } });

  listByTeam: ProjectApi["listByTeam"] = (input) =>
    this.overrides.listByTeam?.(input) ?? Promise.resolve([]);

  create: ProjectApi["create"] = (input, by) =>
    this.overrides.create?.(input, by) ?? this.unimplemented("create");

  updateSettings: ProjectApi["updateSettings"] = (input) =>
    this.overrides.updateSettings?.(input) ?? this.unimplemented("updateSettings");

  archive: ProjectApi["archive"] = (input) =>
    this.overrides.archive?.(input) ?? Promise.resolve({ alreadyArchived: false });

  regenerateLegacyProjectKey: ProjectApi["regenerateLegacyProjectKey"] = (input) =>
    this.overrides.regenerateLegacyProjectKey?.(input) ??
    this.unimplemented("regenerateLegacyProjectKey");

  findIdByLegacyApiKey: ProjectApi["findIdByLegacyApiKey"] = (input) =>
    this.overrides.findIdByLegacyApiKey?.(input) ?? Promise.resolve(null);

  rotateLegacyApiKey: ProjectApi["rotateLegacyApiKey"] = (input) =>
    this.overrides.rotateLegacyApiKey?.(input) ?? this.unimplemented("rotateLegacyApiKey");

  findPersonalWorkspaceOwner: ProjectApi["findPersonalWorkspaceOwner"] = (input) =>
    this.overrides.findPersonalWorkspaceOwner?.(input) ?? Promise.resolve(null);

  findTraceSharingConfig: ProjectApi["findTraceSharingConfig"] = (input) =>
    this.overrides.findTraceSharingConfig?.(input) ?? Promise.resolve(null);

  requestTopicClustering: ProjectApi["requestTopicClustering"] = (input, by) =>
    this.overrides.requestTopicClustering?.(input, by) ??
    this.unimplemented("requestTopicClustering");

  touchCodingAgentPullRequestSeen: ProjectApi["touchCodingAgentPullRequestSeen"] = (input) =>
    this.overrides.touchCodingAgentPullRequestSeen?.(input) ?? Promise.resolve();

  touchCodingAgentSessionSeen: ProjectApi["touchCodingAgentSessionSeen"] = (input) =>
    this.overrides.touchCodingAgentSessionSeen?.(input) ?? Promise.resolve();

  findInternal: ProjectApi["findInternal"] = (input) =>
    this.overrides.findInternal?.(input) ?? Promise.resolve(null);

  findInternalIds: ProjectApi["findInternalIds"] = (input) =>
    this.overrides.findInternalIds?.(input) ?? this.unimplemented("findInternalIds");

  ensureInternal: ProjectApi["ensureInternal"] = (input) =>
    this.overrides.ensureInternal?.(input) ?? this.unimplemented("ensureInternal");

  findIdentity: ProjectApi["findIdentity"] = (id) =>
    this.overrides.findIdentity?.(id) ?? Promise.resolve(null);

  listActiveByScopes: ProjectApi["listActiveByScopes"] = (input) =>
    this.overrides.listActiveByScopes?.(input) ?? Promise.resolve({ data: [], hasMore: false });

  updateMetadata: ProjectApi["updateMetadata"] = (input) =>
    this.overrides.updateMetadata?.(input) ?? this.unimplemented("updateMetadata");

  resolveOrgAdmin: ProjectApi["resolveOrgAdmin"] = (projectId) =>
    this.overrides.resolveOrgAdmin?.(projectId) ?? this.unimplemented("resolveOrgAdmin");

  resolveTraceDestination: ProjectApi["resolveTraceDestination"] = (input) =>
    this.overrides.resolveTraceDestination?.(input) ??
    this.unimplemented("resolveTraceDestination");

  findTraceDestination: ProjectApi["findTraceDestination"] = (projectId) =>
    this.overrides.findTraceDestination?.(projectId) ?? Promise.resolve(null);

  listTraceDestinations: ProjectApi["listTraceDestinations"] = (projectIds) =>
    this.overrides.listTraceDestinations?.(projectIds) ?? Promise.resolve([]);

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestProjectApi does not implement ${operation}`));
  }
}

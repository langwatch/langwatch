import type { ProjectApi } from "@langwatch/project-contract";

/**
 * A complete `ProjectApi` fake, so a transport suite stays at the module
 * boundary: the operations a test cares about are overridden, the absences a
 * surface treats as normal answer null, and everything else refuses by name.
 */
export class TestProjectApi implements ProjectApi {
  constructor(private readonly overrides: Partial<ProjectApi>) {}

  tryGetOrganizationId: ProjectApi["tryGetOrganizationId"] = (projectId) =>
    this.overrides.tryGetOrganizationId?.(projectId) ??
    this.unimplemented("tryGetOrganizationId");

  searchByQuery: ProjectApi["searchByQuery"] = (input) =>
    this.overrides.searchByQuery?.(input) ?? this.unimplemented("searchByQuery");

  listNamesByIds: ProjectApi["listNamesByIds"] = (input) =>
    this.overrides.listNamesByIds?.(input) ?? this.unimplemented("listNamesByIds");

  listIdsByOrganization: ProjectApi["listIdsByOrganization"] = (input) =>
    this.overrides.listIdsByOrganization?.(input) ??
    this.unimplemented("listIdsByOrganization");

  listPaths: ProjectApi["listPaths"] = (input) =>
    this.overrides.listPaths?.(input) ?? this.unimplemented("listPaths");

  isPresenceEnabled: ProjectApi["isPresenceEnabled"] = (input) =>
    this.overrides.isPresenceEnabled?.(input) ?? Promise.resolve(false);

  tryGetSummaryById: ProjectApi["tryGetSummaryById"] = (projectId) =>
    this.overrides.tryGetSummaryById?.(projectId) ?? Promise.resolve(null);

  tryGetById: ProjectApi["tryGetById"] = (id) =>
    this.overrides.tryGetById?.(id) ?? Promise.resolve(null);

  getOrganizationId: ProjectApi["getOrganizationId"] = (projectId) =>
    this.overrides.getOrganizationId?.(projectId) ?? this.unimplemented("getOrganizationId");

  getWithTeam: ProjectApi["getWithTeam"] = (id) =>
    this.overrides.getWithTeam?.(id) ?? this.unimplemented("getWithTeam");

  tryGetWithTeam: ProjectApi["tryGetWithTeam"] = (id) =>
    this.overrides.tryGetWithTeam?.(id) ?? Promise.resolve(null);

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

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestProjectApi does not implement ${operation}`));
  }
}

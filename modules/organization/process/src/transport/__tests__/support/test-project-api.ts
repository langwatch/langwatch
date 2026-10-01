/**
 * A complete `ProjectApi` boundary for the teams family's suite. Only the
 * `GET /api/teams/:id/projects` read is answered; everything else refuses
 * by name, so an unexpected route fails here rather than on a stub's default.
 */
import type { Project, ProjectApi } from "@langwatch/project-contract";

const unsupported = <Method>(name: string): Method =>
  (() =>
    Promise.reject(new Error(`ProjectApi.${name} is not reached by the teams family`))) as Method;

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

  countUsage(): Promise<{ projects: number; teams: number; updatedProjects: number }> {
    return Promise.resolve({ projects: 0, teams: 0, updatedProjects: 0 });
  }

  readonly #byTeam: ReadonlyMap<string, readonly Project[]>;

  private constructor(byTeam: ReadonlyMap<string, readonly Project[]>) {
    this.#byTeam = byTeam;
  }

  static create(
    options: { byTeam?: Readonly<Record<string, readonly Project[]>> } = {},
  ): TestProjectApi {
    return new TestProjectApi(new Map(Object.entries(options.byTeam ?? {})));
  }

  async listByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return [...(this.#byTeam.get(input.teamId) ?? [])];
  }

  listPaths = unsupported<ProjectApi["listPaths"]>("listPaths");
  findOrganizationId = unsupported<ProjectApi["findOrganizationId"]>("findOrganizationId");
  isPresenceEnabled = unsupported<ProjectApi["isPresenceEnabled"]>("isPresenceEnabled");
  findSummaryById = unsupported<ProjectApi["findSummaryById"]>("findSummaryById");
  searchByQuery = unsupported<ProjectApi["searchByQuery"]>("searchByQuery");
  findById = unsupported<ProjectApi["findById"]>("findById");
  getOrganizationId = unsupported<ProjectApi["getOrganizationId"]>("getOrganizationId");
  getWithTeam = unsupported<ProjectApi["getWithTeam"]>("getWithTeam");
  findWithTeam = unsupported<ProjectApi["findWithTeam"]>("findWithTeam");
  listByOrganization = unsupported<ProjectApi["listByOrganization"]>("listByOrganization");
  listNamesByIds = unsupported<ProjectApi["listNamesByIds"]>("listNamesByIds");
  listIdsByOrganization = unsupported<ProjectApi["listIdsByOrganization"]>("listIdsByOrganization");
  findLiveNonGovernanceIdsByOrganization = unsupported<
    ProjectApi["findLiveNonGovernanceIdsByOrganization"]
  >("findLiveNonGovernanceIdsByOrganization");
  findLiveBySlug = unsupported<ProjectApi["findLiveBySlug"]>("findLiveBySlug");
  findLiveByRef = unsupported<ProjectApi["findLiveByRef"]>("findLiveByRef");
  create = unsupported<ProjectApi["create"]>("create");
  updateSettings = unsupported<ProjectApi["updateSettings"]>("updateSettings");
  archive = unsupported<ProjectApi["archive"]>("archive");
  regenerateLegacyProjectKey = unsupported<ProjectApi["regenerateLegacyProjectKey"]>(
    "regenerateLegacyProjectKey",
  );
  findIdByLegacyApiKey = unsupported<ProjectApi["findIdByLegacyApiKey"]>("findIdByLegacyApiKey");
  rotateLegacyApiKey = unsupported<ProjectApi["rotateLegacyApiKey"]>("rotateLegacyApiKey");
  findTraceSharingConfig =
    unsupported<ProjectApi["findTraceSharingConfig"]>("findTraceSharingConfig");
  findPersonalWorkspaceOwner = unsupported<ProjectApi["findPersonalWorkspaceOwner"]>(
    "findPersonalWorkspaceOwner",
  );
  requestTopicClustering =
    unsupported<ProjectApi["requestTopicClustering"]>("requestTopicClustering");
  touchCodingAgentPullRequestSeen = unsupported<ProjectApi["touchCodingAgentPullRequestSeen"]>(
    "touchCodingAgentPullRequestSeen",
  );
  touchCodingAgentSessionSeen = unsupported<ProjectApi["touchCodingAgentSessionSeen"]>(
    "touchCodingAgentSessionSeen",
  );
  findInternal = unsupported<ProjectApi["findInternal"]>("findInternal");
  ensureInternal = unsupported<ProjectApi["ensureInternal"]>("ensureInternal");
  findInternalIds = unsupported<ProjectApi["findInternalIds"]>("findInternalIds");
  findIdentity = unsupported<ProjectApi["findIdentity"]>("findIdentity");
  listActiveByScopes = unsupported<ProjectApi["listActiveByScopes"]>("listActiveByScopes");
  updateMetadata = unsupported<ProjectApi["updateMetadata"]>("updateMetadata");
  resolveOrgAdmin = unsupported<ProjectApi["resolveOrgAdmin"]>("resolveOrgAdmin");
  resolveTraceDestination =
    unsupported<ProjectApi["resolveTraceDestination"]>("resolveTraceDestination");
  findTraceDestination = unsupported<ProjectApi["findTraceDestination"]>("findTraceDestination");
  listTraceDestinations = unsupported<ProjectApi["listTraceDestinations"]>("listTraceDestinations");
}

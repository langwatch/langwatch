import { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  ProjectApi,
  type ProjectApi as ProjectApiContract,
  type ActiveProjectsByScopes,
  type ActiveProjectsByScopesInput,
  type InternalProject,
  type InternalProjectQuery,
  type OrgAdminResolution,
  type Project,
  type ProjectIdentity,
  type ProjectWithTeam,
  type PaginatedProjects,
  type TopicClusteringRequest,
  type TraceDestinationDecision,
  type TraceDestinationInput,
  type TraceDestinationProject,
  type TraceSharingConfig,
  type UpdateProjectInput,
  type UpdateProjectMetadataInput,
} from "@langwatch/project-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi } from "@langwatch/topic-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import { ProjectOperationsService } from "../services/project-operations.service.ts";
import { ProjectCredentialsService } from "../services/project-credentials.service.ts";
import type { ProjectRepositories } from "../repositories/project.repositories.ts";
import { ProjectService as ProjectApplicationService } from "../services/project.service.ts";

export type ProjectInfrastructure = Readonly<{
  topicClustering: {
    requestClustering(input: {
      tenantId: string;
      occurredAt: number;
      trigger: "manual";
      requestedByUserId: string;
    }): Promise<void>;
  };
  now?: (() => number) | undefined;
}>;

export type TopicClusteringCommands = ProjectInfrastructure["topicClustering"];

type ProjectDependencies = Readonly<{
  organizations: typeof OrganizationApi;
  apiKeys: typeof ApiKeyApi;
  share: typeof ShareApi;
  topics: typeof TopicApi;
}>;
type ProjectSetup = FeatureSetup<
  ProjectDependencies,
  ProjectInfrastructure,
  undefined,
  ProjectRepositories
>;

export class ProjectApp implements ProjectApiContract {
  listPaths(input: { projectIds: string[] }) {
    return this.#projectService.listPaths(input);
  }

  static readonly contract = ProjectApi;
  static readonly dependencies: ProjectDependencies = {
    organizations: OrganizationApi,
    apiKeys: ApiKeyApi,
    share: ShareApi,
    topics: TopicApi,
  };

  readonly #projectService: ProjectApplicationService;
  readonly #operations: ProjectOperationsService;
  private constructor(
    projectService: ProjectApplicationService,
    operations: ProjectOperationsService,
  ) {
    this.#projectService = projectService;
    this.#operations = operations;
  }

  static create({ members, dependencies, repositories }: ProjectSetup): ProjectApp {
    const projects = ProjectApplicationService.create({
      repository: repositories.projects,
      credentials: ProjectCredentialsService.create(),
      organizations: dependencies.organizations,
    });
    const operations = ProjectOperationsService.create({
      projects,
      apiKeys: dependencies.apiKeys,
      share: dependencies.share,
      topics: dependencies.topics,
      topicClustering: members.topicClustering,
      now: members.now ?? (() => nowInstant().epochMilliseconds),
    });
    return new ProjectApp(projects, operations);
  }

  isPresenceEnabled(input: { projectId: string }) {
    return this.#projectService.isPresenceEnabled(input);
  }

  tryGetOrganizationId(projectId: string): Promise<string | undefined> {
    return this.#projectService.tryGetOrganizationId(projectId);
  }

  tryGetSummaryById(projectId: string) {
    return this.#projectService.tryGetSummaryById(projectId);
  }

  searchByQuery(input: { query: string; organizationId?: string; limit?: number }) {
    return this.#projectService.searchByQuery(input);
  }

  tryGetById(id: string) {
    return this.#projectService.tryGetById(id);
  }

  getOrganizationId(projectId: string) {
    return this.#projectService.getOrganizationId(projectId);
  }

  getWithTeam(id: string): Promise<ProjectWithTeam> {
    return this.#projectService.getWithTeam(id);
  }

  tryGetWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.#projectService.tryGetWithTeam(id);
  }

  listByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects> {
    return this.#projectService.listByOrganization(input);
  }

  listByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return this.#projectService.listByTeam(input);
  }

  listNamesByIds(input: import("@langwatch/project-contract").ProjectNamesByIdsInput) {
    return this.#projectService.listNamesByIds(input);
  }

  listIdsByOrganization(
    input: import("@langwatch/project-contract").ProjectIdsByOrganizationInput,
  ) {
    return this.#projectService.listIdsByOrganization(input);
  }

  create(
    input: Readonly<{
      organizationId: string;
      teamId?: string | undefined;
      newTeamName?: string | undefined;
      name: string;
      language: string;
      framework: string;
    }>,
    by: Readonly<{ id: string }>,
  ): Promise<Project> {
    return this.#operations.create(input, by);
  }

  updateSettings(input: Readonly<UpdateProjectInput & { projectId: string }>): Promise<Project> {
    return this.#operations.updateSettings(input);
  }

  archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }> {
    return this.#operations.archive(input);
  }

  regenerateLegacyProjectKey(input: Readonly<{ projectId: string }>): Promise<string> {
    return this.#operations.regenerateLegacyProjectKey(input);
  }

  findIdByLegacyApiKey(input: Readonly<{ token: string }>): Promise<string | null> {
    return this.#projectService.findIdByLegacyApiKey(input);
  }

  rotateLegacyApiKey(input: Readonly<{ projectId: string; token: string }>): Promise<boolean> {
    return this.#projectService.rotateLegacyApiKey(input);
  }

  /** Both kill switches a trace share is minted under, read off this module's rows. */
  findTraceSharingConfig(
    input: Readonly<{ projectId: string }>,
  ): Promise<TraceSharingConfig | null> {
    return this.#projectService.findTraceSharingConfig(input.projectId);
  }

  findPersonalWorkspaceOwner(
    input: Readonly<{ organizationId: string; scopeId: string }>,
  ): Promise<{ ownerUserId: string | null } | null> {
    return this.#projectService.findPersonalWorkspaceOwner(input);
  }

  requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<TopicClusteringRequest> {
    return this.#operations.requestTopicClustering(input, by);
  }

  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.#projectService.touchCodingAgentPullRequestSeen({
      projectId: input.projectId,
      at: toDate(input.at),
    });
  }

  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.#projectService.touchCodingAgentSessionSeen({
      projectId: input.projectId,
      at: toDate(input.at),
    });
  }

  findInternal(input: InternalProjectQuery): Promise<InternalProject | null> {
    return this.#projectService.findInternal(input);
  }

  ensureInternal(input: InternalProjectQuery): Promise<InternalProject> {
    return this.#projectService.ensureInternal(input);
  }

  findIdentity(id: string): Promise<ProjectIdentity | null> {
    return this.#projectService.findIdentity(id);
  }

  listActiveByScopes(input: ActiveProjectsByScopesInput): Promise<ActiveProjectsByScopes> {
    return this.#projectService.listActiveByScopes(input);
  }

  updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.#projectService.updateMetadata(input);
  }

  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution> {
    return this.#projectService.resolveOrgAdmin(projectId);
  }

  resolveTraceDestination(input: TraceDestinationInput): Promise<TraceDestinationDecision> {
    return this.#projectService.resolveTraceDestination(input);
  }

  findTraceDestination(projectId: string): Promise<TraceDestinationProject | null> {
    return this.#projectService.findTraceDestination(projectId);
  }

  listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]> {
    return this.#projectService.listTraceDestinations(projectIds);
  }
}

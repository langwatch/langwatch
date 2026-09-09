import { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  ProjectApi,
  type ProjectApi as ProjectApiContract,
  type Project,
  type ProjectWithTeam,
  type PaginatedProjects,
  type ProjectService,
  type TopicClusteringRequest,
  type UpdateProjectInput,
} from "@langwatch/project-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi } from "@langwatch/topic-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import { ProjectOperationsService } from "../services/project-operations.service.ts";
import { PostgresProjectAdapter } from "../adapters/postgres.project.adapter.ts";
import { ProjectCredentialsAdapter } from "../adapters/project-credentials.adapter.ts";
import type { PrismaProjectDatabase } from "../repositories/prisma/prisma.project.repository.ts";

export type ProjectInfrastructure = Readonly<{
  database: PrismaProjectDatabase;
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
type ProjectSetup = FeatureSetup<ProjectDependencies, ProjectInfrastructure, undefined>;

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

  readonly #projectService: ProjectService;
  readonly #operations: ProjectOperationsService;
  private constructor(projectService: ProjectService, operations: ProjectOperationsService) {
    this.#projectService = projectService;
    this.#operations = operations;
  }

  static create({ infrastructure, dependencies }: ProjectSetup): ProjectApp {
    const projects = PostgresProjectAdapter.create({
      database: infrastructure.database,
      credentials: ProjectCredentialsAdapter.create(),
      organizations: dependencies.organizations,
    }).build();
    const operations = ProjectOperationsService.create({
      projects,
      apiKeys: dependencies.apiKeys,
      share: dependencies.share,
      topics: dependencies.topics,
      topicClustering: infrastructure.topicClustering,
      now: infrastructure.now ?? (() => nowInstant().epochMilliseconds),
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
}

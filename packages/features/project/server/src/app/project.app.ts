import type { ApiKeyService } from "@langwatch/api-key-contract";
import {
  ProjectApi,
  type ProjectApi as ProjectApiContract,
  type Project,
  type ProjectService,
  type TopicClusteringRequest,
  type UpdateProjectInput,
} from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";
import { nowInstant } from "@langwatch/time";
import { ProjectOperationsService } from "../services/project-operations.service.ts";

export type ProjectInfrastructure = Readonly<{
  projects: ProjectService;
  apiKeys: ApiKeyService;
  share: ShareService;
  topics: TopicService;
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

type ProjectSetup = FeatureSetup<Record<never, never>, ProjectInfrastructure, undefined>;

export class ProjectApp implements ProjectApiContract {
  static readonly contract = ProjectApi;
  static readonly dependencies = {};

  private constructor(
    private readonly projectService: ProjectService,
    private readonly operations: ProjectOperationsService,
  ) {}

  static create(setup: ProjectSetup | ProjectInfrastructure): ProjectApp {
    const infrastructure = "infrastructure" in setup ? setup.infrastructure : setup;
    const operations = ProjectOperationsService.create({
      projects: infrastructure.projects,
      apiKeys: infrastructure.apiKeys,
      share: infrastructure.share,
      topics: infrastructure.topics,
      topicClustering: infrastructure.topicClustering,
      now: infrastructure.now ?? (() => nowInstant().epochMilliseconds),
    });
    return new ProjectApp(infrastructure.projects, operations);
  }

  tryGetById(id: string) {
    return this.projectService.tryGetById(id);
  }

  getOrganizationId(projectId: string) {
    return this.projectService.getOrganizationId(projectId);
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
    return this.operations.create(input, by);
  }

  updateSettings(input: Readonly<UpdateProjectInput & { projectId: string }>): Promise<Project> {
    return this.operations.updateSettings(input);
  }

  archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }> {
    return this.operations.archive(input);
  }

  regenerateLegacyProjectKey(input: Readonly<{ projectId: string }>): Promise<string> {
    return this.operations.regenerateLegacyProjectKey(input);
  }

  requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<TopicClusteringRequest> {
    return this.operations.requestTopicClustering(input, by);
  }
}

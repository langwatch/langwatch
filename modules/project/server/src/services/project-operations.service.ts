import type { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  ProjectNotFoundError,
  type Project,
  type TopicClusteringRequest,
  type UpdateProjectInput,
} from "@langwatch/project-contract";
import type { ProjectService } from "./project.service.ts";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";

/** The four project operations these use cases orchestrate, and nothing else. */
export type ProjectOperationsDirectory = Pick<
  ProjectService,
  "create" | "tryGetWithTeam" | "update" | "archive"
>;

type ProjectOperationsDependencies = Readonly<{
  readonly projects: ProjectOperationsDirectory;
  readonly apiKeys: ApiKeyApi;
  readonly share: ShareApi;
  readonly topics: TopicApi;
  readonly topicClustering: {
    requestClustering(input: {
      tenantId: string;
      occurredAt: number;
      trigger: "manual";
      requestedByUserId: string;
    }): Promise<void>;
  };
  readonly now: () => number;
}>;

type ProjectCaller = Readonly<{ id: string }>;

export class ProjectOperationsService {
  private constructor(private readonly dependencies: ProjectOperationsDependencies) {}

  static create(dependencies: ProjectOperationsDependencies): ProjectOperationsService {
    return new ProjectOperationsService(dependencies);
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
    by: ProjectCaller,
  ): Promise<Project> {
    return this.dependencies.projects.create({
      organizationId: input.organizationId,
      userId: by.id,
      teamId: input.teamId,
      newTeamName: input.newTeamName,
      name: input.name,
      language: input.language,
      framework: input.framework,
    });
  }

  async updateSettings(
    input: Readonly<UpdateProjectInput & { projectId: string }>,
  ): Promise<Project> {
    const project = await this.dependencies.projects.tryGetWithTeam(input.projectId);
    if (!project) {
      throw new ProjectNotFoundError();
    }

    const data: UpdateProjectInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.framework !== undefined && { framework: input.framework }),
      ...(input.userLinkTemplate !== undefined && {
        userLinkTemplate: input.userLinkTemplate,
      }),
      ...(input.teamId !== undefined && { teamId: input.teamId }),
      traceSharingEnabled: input.traceSharingEnabled,
      presenceEnabled: input.presenceEnabled,
      s3Endpoint: input.s3Endpoint ?? null,
      s3AccessKeyId: input.s3AccessKeyId ?? null,
      s3SecretAccessKey: input.s3SecretAccessKey ?? null,
      s3Bucket: input.s3Bucket,
    };
    const updated = await this.dependencies.projects.update({
      id: input.projectId,
      organizationId: project.team.organizationId,
      data,
    });

    if (input.traceSharingEnabled === false && project.traceSharingEnabled === true) {
      await this.dependencies.share.revokeAllTraceShares(input.projectId);
    }

    return updated;
  }

  async archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }> {
    const target = await this.dependencies.projects.tryGetWithTeam(input.projectId);
    if (!target) {
      return { alreadyArchived: true };
    }

    try {
      await this.dependencies.projects.archive({
        id: input.projectId,
        organizationId: target.team.organizationId,
      });

      return { alreadyArchived: false };
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        return { alreadyArchived: true };
      }

      throw error;
    }
  }

  regenerateLegacyProjectKey(input: Readonly<{ projectId: string }>): Promise<string> {
    return this.dependencies.apiKeys.regenerateLegacyProjectKey(input);
  }

  async requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: ProjectCaller,
  ): Promise<TopicClusteringRequest> {
    const status = await this.dependencies.topics.getClusteringStatus(input);
    if (status.isRunInFlight) {
      return { started: false, reason: "already_running" };
    }

    await this.dependencies.topicClustering.requestClustering({
      tenantId: input.projectId,
      occurredAt: this.dependencies.now(),
      trigger: "manual",
      requestedByUserId: by.id,
    });

    return { started: true };
  }
}

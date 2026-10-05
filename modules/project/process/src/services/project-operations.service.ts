import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { generate } from "@langwatch/ksuid";
import {
  ProjectNotFoundError,
  ProjectS3SecretRequiredError,
  type Project,
  type TopicClusteringRequest,
  type UpdateProjectInput,
  type ProjectLegacyKeyStatus,
} from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";

import {
  isLegacyKeyRevoked,
  REVOKED_LEGACY_KEY_PREFIX,
} from "../rules/legacy-project-key.rules.ts";
import type { ProjectCreatedNoticeService } from "./project-created-notice.service.ts";
import type { ProjectService } from "./project.service.ts";

/** The four project operations these use cases orchestrate, and nothing else. */
export type ProjectOperationsDirectory = Pick<
  ProjectService,
  "create" | "findWithTeam" | "update" | "archive" | "getById" | "rotateLegacyApiKey"
>;

type ProjectOperationsDependencies = Readonly<{
  readonly projects: ProjectOperationsDirectory;
  readonly auditLog: AuditLogApi;
  readonly lifecycle: Pick<
    ProjectCreatedNoticeService,
    "legacyKeyRevoked" | "presenceSettingChanged"
  >;
  /** Where a best-effort failure is reported when nothing can be done about it. */
  readonly logger: Readonly<{
    error(payload: Readonly<Record<string, unknown>>, message: string): void;
  }>;
  readonly share: ShareApi;
  readonly topics: Pick<TopicApi, "getClusteringStatus" | "requestClustering">;
  readonly now: () => number;
}>;

const REVOKED_KEY_KSUID_RESOURCE = "project";

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
    by: ProjectCaller,
  ): Promise<Project> {
    const project = await this.dependencies.projects.findWithTeam(input.projectId);
    if (!project) {
      throw new ProjectNotFoundError();
    }
    if (input.s3Endpoint && input.s3SecretAccessKey === undefined && !project.s3SecretAccessKey) {
      throw new ProjectS3SecretRequiredError();
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
      ...(input.s3SecretAccessKey !== undefined && { s3SecretAccessKey: input.s3SecretAccessKey }),
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
    if (input.presenceEnabled !== undefined && input.presenceEnabled !== project.presenceEnabled) {
      await this.dependencies.lifecycle.presenceSettingChanged({
        projectId: input.projectId,
        organizationId: project.team.organizationId,
        presenceEnabled: input.presenceEnabled,
        changedByUserId: by.id,
      });
    }

    return updated;
  }

  async archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }> {
    const target = await this.dependencies.projects.findWithTeam(input.projectId);
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

  async getLegacyKeyStatus(
    input: Readonly<{ projectId: string }>,
  ): Promise<ProjectLegacyKeyStatus> {
    const project = await this.dependencies.projects.getById(input.projectId);

    return { present: !isLegacyKeyRevoked(project.apiKey) };
  }

  /** Idempotent: a project with no legacy key is left with a fresh unusable one. */
  async revokeLegacyProjectKey(
    input: Readonly<{ projectId: string }>,
    by: ProjectCaller,
  ): Promise<void> {
    const project = await this.dependencies.projects.findWithTeam(input.projectId);
    if (!project) {
      throw new ProjectNotFoundError();
    }
    const revoked = await this.dependencies.projects.rotateLegacyApiKey({
      projectId: input.projectId,
      token: `${REVOKED_LEGACY_KEY_PREFIX}${generate(REVOKED_KEY_KSUID_RESOURCE).toString()}`,
    });
    if (!revoked) {
      throw new ProjectNotFoundError();
    }
    await this.recordApiKeyRevoked({ userId: by.id, projectId: input.projectId });
    await this.dependencies.lifecycle.legacyKeyRevoked({
      projectId: input.projectId,
      organizationId: project.team.organizationId,
      revokedByUserId: by.id,
    });
  }

  /** Best effort: an audit failure must not undo a revocation that has happened. */
  private async recordApiKeyRevoked(
    entry: Readonly<{ userId: string; projectId: string }>,
  ): Promise<void> {
    try {
      await this.dependencies.auditLog.record({
        action: "project.apiKey.revoked",
        userId: entry.userId,
        projectId: entry.projectId,
      });
    } catch (error) {
      this.dependencies.logger.error(
        { error, projectId: entry.projectId },
        "Recording the project API key revocation in the audit log failed.",
      );
    }
  }

  async requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: ProjectCaller,
  ): Promise<TopicClusteringRequest> {
    const status = await this.dependencies.topics.getClusteringStatus(input);
    if (status.isRunInFlight) {
      return { started: false, reason: "already_running" };
    }

    await this.dependencies.topics.requestClustering({
      projectId: input.projectId,
      occurredAt: this.dependencies.now(),
      trigger: "manual",
      requestedByUserId: by.id,
    });

    return { started: true };
  }
}

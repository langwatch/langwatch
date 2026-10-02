import { NotFoundError } from "@langwatch/handled-error";
import {
  WorkflowNotFoundError,
  type WorkflowVersion,
  type WorkflowVersionHistoryEntry,
  type WorkflowVersionHistoryMode,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";

import type { WorkflowDslMigration } from "../app/workflow.app.ts";
import type { WorkflowRepository } from "../repositories/workflow.repository.ts";

/** A workflow's version history, and moving its current version back to one of them. */
export class WorkflowVersionHistoryService {
  static create({
    repository,
    dslMigration,
  }: {
    repository: WorkflowRepository;
    dslMigration: WorkflowDslMigration;
  }): WorkflowVersionHistoryService {
    return new WorkflowVersionHistoryService(repository, dslMigration);
  }

  private constructor(
    private readonly repository: WorkflowRepository,
    private readonly dslMigration: WorkflowDslMigration,
  ) {}

  async getVersionHistory({
    workflow,
    workflowId,
    projectId,
    mode,
  }: {
    workflow: WorkflowWithVersion;
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]> {
    const records = await this.repository.findVersionHistory({
      workflowId,
      projectId,
      includeDsl: mode === "allDsl",
    });
    const current = records.find((record) => record.id === workflow.currentVersionId);
    const previousVersionId = current?.parent?.id;
    const previousVersion =
      mode === "previousDsl" && previousVersionId
        ? await this.repository.findVersionById({
            id: previousVersionId,
            projectId,
          })
        : null;

    return records.map((record) => ({
      id: record.id,
      version: record.version,
      autoSaved: record.autoSaved,
      commitMessage: record.commitMessage,
      updatedAt: record.updatedAt,
      ...(record.dsl ? { dsl: record.dsl } : {}),
      ...(record.id === workflow.currentVersionId
        ? { isCurrentVersion: true as const, parent: record.parent }
        : {}),
      ...(record.id === workflow.latestVersionId ? { isLatestVersion: true as const } : {}),
      ...(record.id === workflow.publishedId ? { isPublishedVersion: true as const } : {}),
      ...(record.id === previousVersionId
        ? {
            isPreviousVersion: true as const,
            ...(previousVersion ? { dsl: previousVersion.dsl } : {}),
          }
        : {}),
      author: record.author,
    }));
  }

  async restoreVersion(input: { versionId: string; projectId: string }): Promise<WorkflowVersion> {
    const version = await this.repository.findVersionById({
      id: input.versionId,
      projectId: input.projectId,
    });
    if (!version) {
      throw new NotFoundError("workflow_version_not_found", {
        resource: "Workflow version",
        id: input.versionId,
      });
    }

    const workflow = await this.repository.findById({
      id: version.workflowId,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!workflow) {
      throw new WorkflowNotFoundError(version.workflowId, input.projectId);
    }

    const dsl = this.dslMigration.migrate(version.dsl);
    await this.repository.updateWorkflow({
      id: workflow.id,
      projectId: input.projectId,
      data: {
        name: dsl.name,
        icon: dsl.icon,
        description: dsl.description,
        currentVersionId: version.id,
      },
    });

    return { ...version, dsl };
  }
}

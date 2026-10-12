import { NotFoundError } from "@langwatch/handled-error";
import {
  dslWithoutHttpAgentSecrets,
  WorkflowNotFoundError,
  type SaveWorkflowVersionCommand,
  type WorkflowVersion,
  type WorkflowVersionHistoryEntry,
  type WorkflowVersionHistoryMode,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";

import type { WorkflowDslMigration, WorkflowId } from "../app/workflow.app.ts";
import type {
  PersistWorkflowVersionInput,
  WorkflowRepository,
} from "../repositories/workflow.repository.ts";
import { WorkflowDslService } from "./workflow-dsl.service.ts";

/** KSUID resource for a version row; the prefix is already on the database. */
const WORKFLOW_VERSION_KSUID_RESOURCE = "workflowversion";

/** A workflow's version history: saving a version, reading them, and moving back to one. */
export class WorkflowVersionHistoryService {
  static create({
    repository,
    dslMigration,
    ids,
  }: {
    repository: WorkflowRepository;
    dslMigration: WorkflowDslMigration;
    ids: WorkflowId;
  }): WorkflowVersionHistoryService {
    return new WorkflowVersionHistoryService(repository, dslMigration, ids);
  }

  private constructor(
    private readonly repository: WorkflowRepository,
    private readonly dslMigration: WorkflowDslMigration,
    private readonly ids: WorkflowId,
  ) {}

  private readonly dsl = WorkflowDslService.create();

  /** Numbers the version, reuses the auto-save slot, and moves the workflow's pointers. */
  async save({
    command,
    parentId,
  }: {
    command: SaveWorkflowVersionCommand;
    parentId: string | null;
  }): Promise<WorkflowVersion> {
    const versions = await this.repository.findVersions({
      workflowId: command.workflowId,
      projectId: command.projectId,
    });
    const latest = versions[0];
    const major = Number.parseInt((latest?.version ?? "0.0").split(".")[0] ?? "0", 10);
    const dsl = dslWithoutHttpAgentSecrets({
      ...command.dsl,
      workflow_id: command.workflowId,
      state: {},
    });
    const persist: PersistWorkflowVersionInput = {
      id: this.ids.next(WORKFLOW_VERSION_KSUID_RESOURCE),
      workflowId: command.workflowId,
      projectId: command.projectId,
      parentId,
      version: command.autoSaved ? String(major + 1) : String(command.dsl.version),
      autoSaved: command.autoSaved,
      commitMessage: command.commitMessage,
      authorId: command.authorId,
      dsl,
    };
    const autoSaved = versions.find((version) => version.autoSaved);
    const version = autoSaved
      ? await this.repository.updateAutoSavedVersion({
          ...persist,
          id: autoSaved.id,
        })
      : await this.repository.createVersion(persist);
    await this.repository.updateWorkflow({
      id: command.workflowId,
      projectId: command.projectId,
      data: {
        ...this.dsl.metadata(dsl),
        currentVersionId: version.id,
        ...(command.setAsLatestVersion === false ? {} : { latestVersionId: version.id }),
      },
    });

    return version;
  }

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

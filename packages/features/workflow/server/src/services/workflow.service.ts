import { nanoid } from "nanoid";
import {
  archiveWorkflowCommandSchema,
  copyWorkflowCommandSchema,
  createWorkflowCommandSchema,
  publishWorkflowCommandSchema,
  runWorkflowCommandSchema,
  saveWorkflowVersionCommandSchema,
  updateWorkflowCommandSchema,
  WorkflowDslValidationError,
  WorkflowNotFoundError,
  WorkflowNotPublishedError,
  WorkflowService as WorkflowServiceContract,
  WorkflowVersionNotFoundError,
  WorkflowVersionRequiredError,
  type Workflow,
  type WorkflowEvaluatorFields,
  type RunWorkflowCommand,
  type WorkflowVersion,
  type WorkflowVersionHistoryEntry,
  type WorkflowVersionHistoryMode,
  type WorkflowWithVersion,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";
import type { Dataset, DatasetService } from "@langwatch/dataset-contract";
import type {
  WorkflowDslMigrationPort,
  WorkflowExecutionPort,
} from "../ports/workflow.port";
import type {
  PersistWorkflowVersionInput,
  WorkflowRepository,
} from "../repositories/workflow.repository";
import type { StudioEventPreparationInput } from "./studio-event-preparer.service";
import type { StudioEventPreparer } from "./studio-event-preparer.service";
import { WorkflowDslService } from "./workflow-dsl.service";

export type WorkflowServiceOptions = {
  repository: WorkflowRepository;
  datasets: DatasetService;
  execution?: WorkflowExecutionPort;
  studioEvents: StudioEventPreparer;
  dslMigration: WorkflowDslMigrationPort;
  generateId?: () => string;
};

/** Canonical Workflow lifecycle. Persistence and cross-feature capabilities are injected. */
export class WorkflowService extends WorkflowServiceContract {
  static create(options: WorkflowServiceOptions): WorkflowService {
    return new WorkflowService(options);
  }

  private constructor(private readonly options: WorkflowServiceOptions) {
    super();
  }

  private readonly dsl = WorkflowDslService.create();

  enrichStudioEvent(input: StudioEventPreparationInput): Promise<StudioClientEvent> {
    return this.options.studioEvents.enrich(input);
  }

  prepareStudioEvent(input: StudioEventPreparationInput): Promise<StudioClientEvent> {
    return this.options.studioEvents.prepare(input);
  }

  async getById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
  }): Promise<WorkflowWithVersion> {
    const workflow = await this.options.repository.tryFindById(input);
    if (!workflow) throw new WorkflowNotFoundError(input.id, input.projectId);
    return workflow;
  }

  async assertInProject(input: { workflowId: string; projectId: string }): Promise<void> {
    await this.getById({
      id: input.workflowId,
      projectId: input.projectId,
      includeVersion: false,
    });
  }

  async getFields(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowEvaluatorFields> {
    const workflow = await this.getById({
      id: input.workflowId,
      projectId: input.projectId,
      includeVersion: true,
    });
    const fields = this.dsl.evaluatorFields(workflow.currentVersion?.dsl);

    return {
      workflowId: workflow.id,
      workflowName: workflow.name,
      ...(workflow.icon ? { workflowIcon: workflow.icon } : {}),
      ...fields,
    };
  }

  list(input: { projectId: string }): Promise<Workflow[]> {
    return this.options.repository.findAll(input);
  }

  getVersions(input: {
    workflowId: string;
    projectId: string;
    includeDsl?: boolean;
  }): Promise<WorkflowVersion[]> {
    return this.options.repository.findVersions(input);
  }

  async getVersionHistory(input: {
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]> {
    const workflow = await this.getById({
      id: input.workflowId,
      projectId: input.projectId,
    });
    const records = await this.options.repository.findVersionHistory({
      workflowId: input.workflowId,
      projectId: input.projectId,
      includeDsl: input.mode === "allDsl",
    });
    const current = records.find((record) => record.id === workflow.currentVersionId);
    const previousVersionId = current?.parent?.id;
    const previousVersion =
      input.mode === "previousDsl" && previousVersionId
        ? await this.options.repository.tryFindVersionById({
            id: previousVersionId,
            projectId: input.projectId,
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
      ...(record.id === workflow.latestVersionId
        ? { isLatestVersion: true as const }
        : {}),
      ...(record.id === workflow.publishedId
        ? { isPublishedVersion: true as const }
        : {}),
      ...(record.id === previousVersionId
        ? {
            isPreviousVersion: true as const,
            ...(previousVersion ? { dsl: previousVersion.dsl } : {}),
          }
        : {}),
      author: record.author,
    }));
  }

  async restoreVersion(input: {
    versionId: string;
    projectId: string;
  }): Promise<WorkflowVersion> {
    const version = await this.options.repository.tryFindVersionById({
      id: input.versionId,
      projectId: input.projectId,
    });
    if (!version) throw new WorkflowVersionNotFoundError(input.versionId);
    const workflow = await this.options.repository.tryFindById({
      id: version.workflowId,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!workflow) {
      throw new WorkflowNotFoundError(version.workflowId, input.projectId);
    }
    const dsl = this.options.dslMigration.migrate(version.dsl);
    await this.options.repository.updateWorkflow({
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

  async getPublishedVersion(input: {
    workflowId: string;
    projectId: string;
    versionId?: string;
  }): Promise<WorkflowVersion> {
    const workflow = await this.getById({
      id: input.workflowId,
      projectId: input.projectId,
      includeVersion: false,
    });
    const version = await this.options.repository.tryFindPublishedVersion(input);
    if (!version) {
      if (!workflow.publishedId && !input.versionId)
        throw new WorkflowNotPublishedError(input.workflowId);
      throw new WorkflowVersionNotFoundError(
        input.versionId ?? workflow.publishedId ?? "",
      );
    }
    return version;
  }

  async create(
    input: import("@langwatch/workflow-contract").CreateWorkflowCommand,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    const command = this.parse(createWorkflowCommandSchema, input);
    const id = command.id ?? `workflow_${this.id()}`;
    await this.options.repository.createWorkflow({
      id,
      projectId: command.projectId,
      name: command.dsl.name,
      icon: command.dsl.icon ?? null,
      description: command.dsl.description ?? null,
    });
    const version = await this.saveVersion({
      projectId: command.projectId,
      workflowId: id,
      dsl: { ...command.dsl, workflow_id: id },
      commitMessage: command.commitMessage,
      autoSaved: false,
      authorId: command.authorId,
    });
    const published = command.publish
      ? await this.publish({
          id,
          projectId: command.projectId,
          versionId: version.id,
          actorId: command.authorId,
        })
      : await this.getById({ id, projectId: command.projectId, includeVersion: true });
    return { workflow: published, version };
  }

  async update(
    input: import("@langwatch/workflow-contract").UpdateWorkflowCommand,
  ): Promise<Workflow> {
    const command = this.parse(updateWorkflowCommandSchema, input);
    const existing = await this.getById(command);
    const data = this.dsl.metadata({
      name: command.name ?? existing.name,
      icon: command.icon !== undefined ? command.icon : existing.icon,
      description:
        command.description !== undefined ? command.description : existing.description,
    });
    return this.options.repository.updateWorkflow({
      id: command.id,
      projectId: command.projectId,
      data,
    });
  }

  async saveVersion(
    input: import("@langwatch/workflow-contract").SaveWorkflowVersionCommand,
  ): Promise<WorkflowVersion> {
    const command = this.parse(saveWorkflowVersionCommandSchema, input);
    const workflow = await this.getById({
      id: command.workflowId,
      projectId: command.projectId,
      includeVersion: true,
    });
    const versions = await this.options.repository.findVersions({
      workflowId: command.workflowId,
      projectId: command.projectId,
    });
    const latest = versions[0];
    const major = Number.parseInt((latest?.version ?? "0.0").split(".")[0] ?? "0", 10);
    const dsl = { ...command.dsl, workflow_id: command.workflowId, state: {} };
    const persist: PersistWorkflowVersionInput = {
      id: this.id(),
      workflowId: command.workflowId,
      projectId: command.projectId,
      parentId: workflow.currentVersionId,
      version: command.autoSaved ? String(major + 1) : String(command.dsl.version),
      autoSaved: command.autoSaved,
      commitMessage: command.commitMessage,
      authorId: command.authorId,
      dsl,
    };
    const autoSaved = versions.find((version) => version.autoSaved);
    const version = autoSaved
      ? await this.options.repository.updateAutoSavedVersion({
          ...persist,
          id: autoSaved.id,
        })
      : await this.options.repository.createVersion(persist);
    await this.options.repository.updateWorkflow({
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

  async publish(
    input: import("@langwatch/workflow-contract").PublishWorkflowCommand,
  ): Promise<Workflow> {
    const command = this.parse(publishWorkflowCommandSchema, input);
    const version = await this.options.repository.tryFindVersion({
      id: command.versionId,
      workflowId: command.id,
      projectId: command.projectId,
    });
    if (!version) throw new WorkflowVersionNotFoundError(command.versionId);
    return this.options.repository.publish(command);
  }

  async unpublish(input: { id: string; projectId: string }): Promise<Workflow> {
    await this.getById(input);
    return this.options.repository.updateWorkflow({
      id: input.id,
      projectId: input.projectId,
      data: { publishedId: null, publishedById: null },
    });
  }

  async archive(
    input: import("@langwatch/workflow-contract").ArchiveWorkflowCommand,
  ): Promise<Workflow> {
    const command = this.parse(archiveWorkflowCommandSchema, input);
    await this.getById(command);
    return this.options.repository.updateWorkflow({
      id: command.id,
      projectId: command.projectId,
      data: { archivedAt: command.unarchive ? null : new Date() },
    });
  }

  async copy(
    input: import("@langwatch/workflow-contract").CopyWorkflowCommand,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    const command = this.parse(copyWorkflowCommandSchema, input);
    const source = await this.getById({
      id: command.sourceWorkflowId,
      projectId: command.sourceProjectId,
      includeVersion: true,
    });
    const sourceVersion =
      source.latestVersion ??
      (await this.latestVersion(command.sourceWorkflowId, command.sourceProjectId));
    const dsl = this.dsl.copy(sourceVersion.dsl);
    if (command.copyDatasets) {
      await this.copyDatasets(dsl, command.sourceProjectId, command.targetProjectId);
    }
    const workflowId = command.id ?? `workflow_${this.id()}`;
    const workflow = await this.options.repository.createWorkflow({
      id: workflowId,
      projectId: command.targetProjectId,
      name: source.name,
      icon: source.icon,
      description: source.description,
      isEvaluator: source.isEvaluator,
      isComponent: source.isComponent,
      copiedFromWorkflowId: command.copiedFromWorkflowId ?? source.id,
    });
    const version = await this.saveVersion({
      workflowId,
      projectId: command.targetProjectId,
      dsl: {
        ...dsl,
        workflow_id: workflowId,
        version: "1",
        experiment_id: "",
        state: {},
      },
      commitMessage: `Copied from ${source.name}`,
      autoSaved: false,
      authorId: command.authorId,
    });
    return {
      workflow: await this.getById({
        id: workflow.id,
        projectId: command.targetProjectId,
        includeVersion: true,
      }),
      version,
    };
  }

  getCopies(input: { workflowId: string; projectId: string }): Promise<Workflow[]> {
    return this.options.repository.findCopies(input);
  }

  async pushToCopies(input: {
    workflowId: string;
    projectId: string;
    copyIds?: string[];
    allowedProjectIds?: string[];
  }): Promise<{ pushedTo: number; selectedCopies: number }> {
    const source = await this.getById({
      id: input.workflowId,
      projectId: input.projectId,
      includeVersion: true,
    });
    const sourceVersion =
      source.latestVersion ?? (await this.latestVersion(source.id, input.projectId));
    const copies = await this.options.repository.findCopies(input);
    const selected = copies.filter(
      (copy) =>
        (!input.copyIds || input.copyIds.includes(copy.id)) &&
        (!input.allowedProjectIds || input.allowedProjectIds.includes(copy.projectId)),
    );
    for (const copy of selected) {
      const dsl = this.dsl.copy(sourceVersion.dsl);
      await this.saveVersion({
        workflowId: copy.id,
        projectId: copy.projectId,
        dsl: { ...dsl, workflow_id: copy.id },
        commitMessage: "Updated from source workflow",
        autoSaved: false,
      });
    }
    return { pushedTo: selected.length, selectedCopies: selected.length };
  }

  async run(input: RunWorkflowCommand): Promise<unknown> {
    if (!this.options.execution) throw new Error("Workflow execution is not configured.");
    const command = this.parse(runWorkflowCommandSchema, input);
    const version = await this.getPublishedVersion({
      workflowId: command.workflowId,
      projectId: command.projectId,
      versionId: command.versionId,
    });
    return this.options.execution.execute({ ...command, version });
  }

  private async latestVersion(
    workflowId: string,
    projectId: string,
  ): Promise<WorkflowVersion> {
    const version = (
      await this.options.repository.findVersions({ workflowId, projectId })
    )[0];
    if (!version) throw new WorkflowVersionRequiredError();
    return version;
  }

  private async copyDatasets(
    dsl: import("@langwatch/workflow-contract").WorkflowDsl,
    sourceProjectId: string,
    targetProjectId: string,
  ): Promise<void> {
    const seen = new Map<string, Dataset>();
    for (const node of dsl.nodes) {
      if (!node || typeof node !== "object") continue;
      const data = (node as { data?: Record<string, unknown> }).data;
      const refs: Array<Record<string, unknown>> = [];
      const dataset = data?.dataset;
      if (dataset && typeof dataset === "object")
        refs.push(dataset as Record<string, unknown>);
      for (const parameter of Array.isArray(data?.parameters) ? data.parameters : []) {
        if (!parameter || typeof parameter !== "object") continue;
        const value = (parameter as { value?: unknown }).value;
        if (value && typeof value === "object")
          refs.push(value as Record<string, unknown>);
      }
      for (const ref of refs) {
        const id = typeof ref.id === "string" ? ref.id : undefined;
        if (!id) continue;
        const copied =
          seen.get(id) ??
          (await this.options.datasets.copyDataset({
            sourceDatasetId: id,
            sourceProjectId,
            targetProjectId,
          }));
        seen.set(id, copied);
        ref.id = copied.id;
        ref.name = copied.name;
      }
    }
  }

  private id(): string {
    return this.options.generateId?.() ?? nanoid();
  }

  private parse<T>(
    schema: {
      safeParse(
        value: unknown,
      ):
        | { success: true; data: T }
        | { success: false; error: { issues: readonly unknown[] } };
    },
    value: unknown,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new WorkflowDslValidationError(result.error.issues);
    return result.data;
  }
}

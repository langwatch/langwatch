import { describe, expect, it } from "vitest";
import type {
  Workflow,
  WorkflowVersion,
  WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import {
  WorkflowNotPublishedError,
  type RunWorkflowCommand,
} from "@langwatch/workflow-contract";
import {
  WorkflowDslMigrationPort,
  WorkflowExecutionPort,
} from "../src/ports/workflow.port";
import { WorkflowService as ServerWorkflowService } from "../src/services/workflow.service";
import {
  WorkflowRepository,
  type PersistWorkflowInput,
  type PersistWorkflowVersionInput,
  type WorkflowVersionHistoryRecord,
} from "../src/repositories/workflow.repository";

const workflow = (id = "workflow_1", projectId = "project_1"): Workflow => ({
  id,
  projectId,
  name: "Triage",
  icon: null,
  description: null,
  latestVersionId: null,
  currentVersionId: null,
  publishedId: null,
  publishedById: null,
  copiedFromWorkflowId: null,
  isEvaluator: false,
  isComponent: false,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

class FakeWorkflowRepository extends WorkflowRepository {
  private readonly workflows = new Map<string, Workflow>();
  private readonly versions = new Map<string, WorkflowVersion>();

  constructor() {
    super();
    this.workflows.set("workflow_1", workflow());
  }
  async tryFindById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
    includeArchived?: boolean;
  }): Promise<WorkflowWithVersion | null> {
    const value = this.workflows.get(input.id);
    if (
      !value ||
      value.projectId !== input.projectId ||
      (!input.includeArchived && value.archivedAt)
    )
      return null;
    const current = value.currentVersionId
      ? this.versions.get(value.currentVersionId)
      : null;
    return {
      ...value,
      ...(input.includeVersion
        ? { currentVersion: current, latestVersion: current }
        : {}),
    };
  }
  async findAll(input: { projectId: string }): Promise<Workflow[]> {
    return [...this.workflows.values()].filter(
      (item) => item.projectId === input.projectId && !item.archivedAt,
    );
  }
  async findVersions(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowVersion[]> {
    return [...this.versions.values()].filter(
      (item) =>
        item.workflowId === input.workflowId && item.projectId === input.projectId,
    );
  }
  async findVersionHistory(input: {
    workflowId: string;
    projectId: string;
    includeDsl: boolean;
  }): Promise<WorkflowVersionHistoryRecord[]> {
    return (await this.findVersions(input)).reverse().map((item) => ({
      id: item.id,
      version: item.version,
      autoSaved: item.autoSaved,
      commitMessage: item.commitMessage,
      updatedAt: item.updatedAt,
      ...(input.includeDsl ? { dsl: item.dsl } : {}),
      parent: item.parentId
        ? {
            id: item.parentId,
            version: this.versions.get(item.parentId)?.version ?? "",
            commitMessage: this.versions.get(item.parentId)?.commitMessage ?? "",
          }
        : null,
      author: null,
    }));
  }
  async tryFindVersionById(input: {
    id: string;
    projectId: string;
  }): Promise<WorkflowVersion | null> {
    const item = this.versions.get(input.id);
    return item?.projectId === input.projectId ? item : null;
  }
  async tryFindVersion(input: {
    id: string;
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowVersion | null> {
    const item = this.versions.get(input.id);
    return item?.workflowId === input.workflowId && item.projectId === input.projectId
      ? item
      : null;
  }
  async tryFindPublishedVersion(input: {
    workflowId: string;
    projectId: string;
    versionId?: string;
  }): Promise<WorkflowVersion | null> {
    const item = this.workflows.get(input.workflowId);
    return item?.publishedId
      ? (this.versions.get(input.versionId ?? item.publishedId) ?? null)
      : null;
  }
  async createWorkflow(input: PersistWorkflowInput): Promise<WorkflowWithVersion> {
    const item = {
      ...workflow(input.id, input.projectId),
      name: input.name,
      icon: input.icon,
      description: input.description,
    };
    this.workflows.set(item.id, item);
    return item;
  }
  async updateWorkflow(input: {
    id: string;
    projectId: string;
    data: Record<string, unknown>;
  }): Promise<Workflow> {
    const item = this.workflows.get(input.id);
    if (!item) throw new Error("missing");
    const updated = { ...item, ...input.data, updatedAt: new Date() } as Workflow;
    this.workflows.set(item.id, updated);
    return updated;
  }
  async createVersion(input: PersistWorkflowVersionInput): Promise<WorkflowVersion> {
    const item = {
      ...input,
      authorId: input.authorId ?? null,
      dsl: input.dsl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.versions.set(item.id, item);
    return item;
  }
  async updateAutoSavedVersion(
    input: PersistWorkflowVersionInput & { id: string },
  ): Promise<WorkflowVersion> {
    return this.createVersion(input);
  }
  async setVersionPointers(): Promise<void> {}
  async publish(input: {
    id: string;
    projectId: string;
    versionId: string;
    actorId?: string;
  }): Promise<Workflow> {
    return this.updateWorkflow({
      id: input.id,
      projectId: input.projectId,
      data: { publishedId: input.versionId, publishedById: input.actorId ?? null },
    });
  }
  async unpublish(input: { id: string; projectId: string }): Promise<Workflow> {
    return this.updateWorkflow({
      id: input.id,
      projectId: input.projectId,
      data: { publishedId: null, publishedById: null },
    });
  }
  async findCopies(): Promise<Workflow[]> {
    return [];
  }
}

class FakeWorkflowExecutionPort extends WorkflowExecutionPort {
  readonly calls: Parameters<WorkflowExecutionPort["execute"]>[0][] = [];

  async execute(
    input: Parameters<WorkflowExecutionPort["execute"]>[0],
  ): Promise<unknown> {
    this.calls.push(input);
    return { status: "success" };
  }
}

class FakeWorkflowDslMigrationPort extends WorkflowDslMigrationPort {
  migrate(dsl: WorkflowVersion["dsl"]): WorkflowVersion["dsl"] {
    return { ...dsl, name: `${dsl.name} migrated` };
  }
}

const service = (
  repository = new FakeWorkflowRepository(),
  options: { execution?: WorkflowExecutionPort } = {},
) =>
  ServerWorkflowService.create({
    repository,
    dslMigration: new FakeWorkflowDslMigrationPort(),
    ...options,
  });

describe("WorkflowService", () => {
  it("creates, versions and publishes through the repository boundary", async () => {
    const workflowService = ServerWorkflowService.create({
      repository: new FakeWorkflowRepository(),
      dslMigration: new FakeWorkflowDslMigrationPort(),
      generateId: () => "id",
    });
    const result = await workflowService.create({
      projectId: "project_1",
      dsl: { version: "1", name: "Triage", nodes: [], edges: [] },
      commitMessage: "first",
      publish: true,
    });
    expect(result.version.workflowId).toBe(result.workflow.id);
    expect(result.workflow.publishedId).toBe(result.version.id);
  });

  it("throws a concrete error when a workflow is not published", async () => {
    await expect(
      service().getPublishedVersion({ workflowId: "workflow_1", projectId: "project_1" }),
    ).rejects.toBeInstanceOf(WorkflowNotPublishedError);
  });

  it("unpublishes through the workflow repository boundary", async () => {
    const repository = new FakeWorkflowRepository();
    const workflowService = service(repository);
    await repository.publish({
      id: "workflow_1",
      projectId: "project_1",
      versionId: "version_1",
    });
    await workflowService.unpublish({ id: "workflow_1", projectId: "project_1" });
    await expect(
      workflowService.getById({ id: "workflow_1", projectId: "project_1" }),
    ).resolves.toMatchObject({ publishedId: null, publishedById: null });
  });

  it("exposes evaluator fields without exposing persistence", async () => {
    const repo = new FakeWorkflowRepository();
    const fields = await service(repo).getFields({
      workflowId: "workflow_1",
      projectId: "project_1",
    });
    expect(fields).toMatchObject({ workflowId: "workflow_1", workflowName: "Triage" });
    expect(fields.outputFields.map((field) => field.identifier)).toEqual([
      "passed",
      "score",
      "label",
    ]);
  });

  it("returns version history with the same sparse tags and previous DSL as the transport", async () => {
    const repository = new FakeWorkflowRepository();
    const previous = await repository.createVersion({
      id: "version_1",
      workflowId: "workflow_1",
      projectId: "project_1",
      parentId: null,
      version: "1",
      autoSaved: false,
      commitMessage: "first",
      dsl: { name: "First", version: "1", nodes: [], edges: [] },
    });
    const current = await repository.createVersion({
      id: "version_2",
      workflowId: "workflow_1",
      projectId: "project_1",
      parentId: previous.id,
      version: "2",
      autoSaved: false,
      commitMessage: "second",
      dsl: { name: "Second", version: "2", nodes: [], edges: [] },
    });
    await repository.updateWorkflow({
      id: "workflow_1",
      projectId: "project_1",
      data: {
        currentVersionId: current.id,
        latestVersionId: current.id,
        publishedId: previous.id,
      },
    });

    await expect(
      service(repository).getVersionHistory({
        workflowId: "workflow_1",
        projectId: "project_1",
        mode: "previousDsl",
      }),
    ).resolves.toEqual([
      {
        id: current.id,
        version: current.version,
        autoSaved: false,
        commitMessage: current.commitMessage,
        updatedAt: expect.any(Date),
        author: null,
        isCurrentVersion: true,
        isLatestVersion: true,
        parent: {
          id: previous.id,
          version: previous.version,
          commitMessage: previous.commitMessage,
        },
      },
      {
        id: previous.id,
        version: previous.version,
        autoSaved: false,
        commitMessage: previous.commitMessage,
        updatedAt: expect.any(Date),
        author: null,
        dsl: previous.dsl,
        isPreviousVersion: true,
        isPublishedVersion: true,
      },
    ]);
  });

  it("restores the migrated graph and updates the workflow display metadata", async () => {
    const repository = new FakeWorkflowRepository();
    const version = await repository.createVersion({
      id: "version_1",
      workflowId: "workflow_1",
      projectId: "project_1",
      parentId: null,
      version: "1",
      autoSaved: false,
      commitMessage: "first",
      dsl: { name: "Old shape", version: "1", nodes: [], edges: [] },
    });

    await expect(
      service(repository).restoreVersion({
        versionId: version.id,
        projectId: "project_1",
      }),
    ).resolves.toMatchObject({
      id: version.id,
      dsl: { name: "Old shape migrated" },
    });
    await expect(
      repository.tryFindById({ id: "workflow_1", projectId: "project_1" }),
    ).resolves.toMatchObject({
      currentVersionId: version.id,
      name: "Old shape migrated",
    });
  });

  it("validates and dispatches a resolved published version through the execution port", async () => {
    const repository = new FakeWorkflowRepository();
    const execution = new FakeWorkflowExecutionPort();
    const workflowService = service(repository, { execution });
    const version = await repository.createVersion({
      id: "version_1",
      workflowId: "workflow_1",
      projectId: "project_1",
      parentId: null,
      version: "1",
      autoSaved: false,
      commitMessage: "first",
      dsl: { name: "Triage", version: "1", nodes: [], edges: [] },
    });
    await repository.publish({
      id: "workflow_1",
      projectId: "project_1",
      versionId: version.id,
    });

    await expect(
      workflowService.run({
        workflowId: "workflow_1",
        projectId: "project_1",
        inputs: { ticket: "42" },
      } satisfies RunWorkflowCommand),
    ).resolves.toEqual({ status: "success" });

    expect(execution.calls).toHaveLength(1);
    expect(execution.calls[0]).toMatchObject({
      workflowId: "workflow_1",
      version: { id: "version_1" },
      inputs: { ticket: "42" },
    });
  });
});

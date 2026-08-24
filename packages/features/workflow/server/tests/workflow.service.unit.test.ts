import { describe, expect, it } from "vitest";
import type { Workflow, WorkflowVersion, WorkflowWithVersion } from "@langwatch/workflow-contract";
import { WorkflowNotPublishedError } from "@langwatch/workflow-contract";
import { WorkflowService as ServerWorkflowService } from "../src/services/workflow.service";
import { WorkflowRepository, type PersistWorkflowInput, type PersistWorkflowVersionInput } from "../src/repositories/workflow.repository";

const workflow = (id = "workflow_1", projectId = "project_1"): Workflow => ({
  id, projectId, name: "Triage", icon: null, description: null,
  latestVersionId: null, currentVersionId: null, publishedId: null,
  publishedById: null, copiedFromWorkflowId: null, isEvaluator: false,
  isComponent: false, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
});

class FakeWorkflowRepository extends WorkflowRepository {
  private readonly workflows = new Map<string, Workflow>();
  private readonly versions = new Map<string, WorkflowVersion>();

  constructor() { super(); this.workflows.set("workflow_1", workflow()); }
  async tryFindById(input: { id: string; projectId: string; includeVersion?: boolean }): Promise<WorkflowWithVersion | null> {
    const value = this.workflows.get(input.id);
    if (!value || value.projectId !== input.projectId || value.archivedAt) return null;
    const current = value.currentVersionId ? this.versions.get(value.currentVersionId) : null;
    return { ...value, ...(input.includeVersion ? { currentVersion: current, latestVersion: current } : {}) };
  }
  async findAll(input: { projectId: string }): Promise<Workflow[]> { return [...this.workflows.values()].filter((item) => item.projectId === input.projectId && !item.archivedAt); }
  async findVersions(input: { workflowId: string; projectId: string }): Promise<WorkflowVersion[]> { return [...this.versions.values()].filter((item) => item.workflowId === input.workflowId && item.projectId === input.projectId); }
  async tryFindVersion(input: { id: string; workflowId: string; projectId: string }): Promise<WorkflowVersion | null> { const item = this.versions.get(input.id); return item?.workflowId === input.workflowId && item.projectId === input.projectId ? item : null; }
  async tryFindPublishedVersion(input: { workflowId: string; projectId: string; versionId?: string }): Promise<WorkflowVersion | null> { const item = this.workflows.get(input.workflowId); return item?.publishedId ? this.versions.get(input.versionId ?? item.publishedId) ?? null : null; }
  async createWorkflow(input: PersistWorkflowInput): Promise<WorkflowWithVersion> { const item = { ...workflow(input.id, input.projectId), name: input.name, icon: input.icon, description: input.description }; this.workflows.set(item.id, item); return item; }
  async updateWorkflow(input: { id: string; projectId: string; data: Record<string, unknown> }): Promise<Workflow> { const item = this.workflows.get(input.id); if (!item) throw new Error("missing"); const updated = { ...item, ...input.data, updatedAt: new Date() } as Workflow; this.workflows.set(item.id, updated); return updated; }
  async createVersion(input: PersistWorkflowVersionInput): Promise<WorkflowVersion> { const item = { ...input, authorId: input.authorId ?? null, dsl: input.dsl, createdAt: new Date(), updatedAt: new Date() }; this.versions.set(item.id, item); return item; }
  async updateAutoSavedVersion(input: PersistWorkflowVersionInput & { id: string }): Promise<WorkflowVersion> { return this.createVersion(input); }
  async setVersionPointers(): Promise<void> {}
  async publish(input: { id: string; projectId: string; versionId: string; actorId?: string }): Promise<Workflow> { return this.updateWorkflow({ id: input.id, projectId: input.projectId, data: { publishedId: input.versionId, publishedById: input.actorId ?? null } }); }
  async unpublish(input: { id: string; projectId: string }): Promise<Workflow> { return this.updateWorkflow({ id: input.id, projectId: input.projectId, data: { publishedId: null, publishedById: null } }); }
  async findCopies(): Promise<Workflow[]> { return []; }
}

describe("WorkflowService", () => {
  it("creates, versions and publishes through the repository boundary", async () => {
    const service = ServerWorkflowService.create({ repository: new FakeWorkflowRepository(), generateId: () => "id" });
    const result = await service.create({ projectId: "project_1", dsl: { version: "1", name: "Triage", nodes: [], edges: [] }, commitMessage: "first", publish: true });
    expect(result.version.workflowId).toBe(result.workflow.id);
    expect(result.workflow.publishedId).toBe(result.version.id);
  });

  it("throws a concrete error when a workflow is not published", async () => {
    const service = ServerWorkflowService.create({ repository: new FakeWorkflowRepository() });
    await expect(service.getPublishedVersion({ workflowId: "workflow_1", projectId: "project_1" })).rejects.toBeInstanceOf(WorkflowNotPublishedError);
  });

  it("unpublishes through the workflow repository boundary", async () => {
    const repository = new FakeWorkflowRepository();
    const service = ServerWorkflowService.create({ repository });
    await repository.publish({
      id: "workflow_1",
      projectId: "project_1",
      versionId: "version_1",
    });
    await service.unpublish({ id: "workflow_1", projectId: "project_1" });
    await expect(
      service.getById({ id: "workflow_1", projectId: "project_1" }),
    ).resolves.toMatchObject({ publishedId: null, publishedById: null });
  });

  it("exposes evaluator fields without exposing persistence", async () => {
    const repo = new FakeWorkflowRepository();
    const service = ServerWorkflowService.create({ repository: repo });
    const fields = await service.getFields({ workflowId: "workflow_1", projectId: "project_1" });
    expect(fields).toMatchObject({ workflowId: "workflow_1", workflowName: "Triage" });
    expect(fields.outputFields.map((field) => field.identifier)).toEqual(["passed", "score", "label"]);
  });
});

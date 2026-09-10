/**
 * The workflow graph rows a process without Postgres keeps, in memory.
 *
 * The same contract the Prisma tier answers: a missing row is null rather than
 * a throw, an archived workflow is invisible unless asked for, and a version
 * read without its DSL still answers with an empty graph rather than nothing.
 */
import {
  workflowDslSchema,
  type Workflow,
  type WorkflowReference,
  type WorkflowVersion,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import {
  WorkflowRepository,
  type PersistWorkflowInput,
  type PersistWorkflowVersionInput,
  type WorkflowVersionHistoryRecord,
} from "../workflow.repository.ts";
import type { WorkflowMemoryStore } from "./workflow-memory.store.ts";

const emptyDsl = (version: string) =>
  workflowDslSchema.parse({ name: "", version, nodes: [], edges: [] });

const withoutDsl = (version: WorkflowVersion): WorkflowVersion => ({
  ...version,
  dsl: emptyDsl(version.version),
});

export class WorkflowMemoryRepository extends WorkflowRepository {
  static create(store: WorkflowMemoryStore): WorkflowMemoryRepository {
    return new WorkflowMemoryRepository(store);
  }

  private constructor(private readonly store: WorkflowMemoryStore) {
    super();
  }

  #liveWorkflow(input: { id: string; projectId: string; includeArchived?: boolean }) {
    const workflow = this.store.workflows.get(input.id);
    if (!workflow || workflow.projectId !== input.projectId) return undefined;
    if (!input.includeArchived && workflow.archivedAt) return undefined;

    return workflow;
  }

  #requireWorkflow(input: { id: string; projectId: string }): Workflow {
    const workflow = this.#liveWorkflow({ ...input, includeArchived: true });
    if (!workflow) throw new Error(`No workflow "${input.id}" in project "${input.projectId}".`);

    return workflow;
  }

  listFieldSources(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<{ id: string; dsl: unknown }[]> {
    return Promise.resolve(
      input.workflowIds
        .map((id) => this.#liveWorkflow({ id, projectId: input.projectId }))
        .filter((workflow): workflow is Workflow => Boolean(workflow))
        .map((workflow) => ({
          id: workflow.id,
          dsl: workflow.currentVersionId
            ? this.store.versions.get(workflow.currentVersionId)?.dsl
            : undefined,
        })),
    );
  }

  listSummaries(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<{ id: string; name: string }[]> {
    return Promise.resolve(
      input.workflowIds
        .map((id) => this.#liveWorkflow({ id, projectId: input.projectId }))
        .filter((workflow): workflow is Workflow => Boolean(workflow))
        .map((workflow) => ({ id: workflow.id, name: workflow.name })),
    );
  }

  archiveLinked(input: WorkflowReference): Promise<{ id: string }> {
    const workflow = this.#requireWorkflow({ id: input.workflowId, projectId: input.projectId });
    this.store.workflows.set(workflow.id, { ...workflow, archivedAt: new Date() });

    return Promise.resolve({ id: workflow.id });
  }

  deleteUncommitted(input: WorkflowReference): Promise<void> {
    this.#requireWorkflow({ id: input.workflowId, projectId: input.projectId });
    for (const version of this.store.versionsOf(input)) this.store.versions.delete(version.id);
    this.store.workflows.delete(input.workflowId);

    return Promise.resolve();
  }

  findById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
    includeArchived?: boolean;
  }): Promise<WorkflowWithVersion | null> {
    const workflow = this.#liveWorkflow(input);
    if (!workflow) return Promise.resolve(null);
    if (!input.includeVersion) return Promise.resolve({ ...workflow });

    return Promise.resolve({
      ...workflow,
      currentVersion: workflow.currentVersionId
        ? (this.store.versions.get(workflow.currentVersionId) ?? null)
        : null,
      latestVersion: workflow.latestVersionId
        ? (this.store.versions.get(workflow.latestVersionId) ?? null)
        : null,
    });
  }

  findAll(input: { projectId: string }): Promise<Workflow[]> {
    return Promise.resolve(
      this.store.workflowsOf(input.projectId).filter((workflow) => !workflow.archivedAt),
    );
  }

  findVersions(input: {
    workflowId: string;
    projectId: string;
    includeDsl?: boolean;
  }): Promise<WorkflowVersion[]> {
    const versions = this.store.versionsOf(input);

    return Promise.resolve(
      input.includeDsl === false ? versions.map((version) => withoutDsl(version)) : versions,
    );
  }

  findVersionHistory(input: {
    workflowId: string;
    projectId: string;
    includeDsl: boolean;
  }): Promise<WorkflowVersionHistoryRecord[]> {
    return Promise.resolve(
      this.store.versionsOf(input).map((version) => {
        const parent = version.parentId ? this.store.versions.get(version.parentId) : undefined;

        return {
          id: version.id,
          version: version.version,
          autoSaved: version.autoSaved,
          commitMessage: version.commitMessage,
          updatedAt: version.updatedAt,
          ...(input.includeDsl ? { dsl: version.dsl } : {}),
          parent: parent
            ? { id: parent.id, version: parent.version, commitMessage: parent.commitMessage }
            : null,
          author: version.authorId
            ? (this.store.authors.get(version.authorId) ?? null)
            : null,
        };
      }),
    );
  }

  findVersionById(input: { id: string; projectId: string }): Promise<WorkflowVersion | null> {
    const version = this.store.versions.get(input.id);

    return Promise.resolve(version && version.projectId === input.projectId ? version : null);
  }

  findVersion(input: {
    id: string;
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowVersion | null> {
    const version = this.store.versions.get(input.id);
    const matches =
      version && version.projectId === input.projectId && version.workflowId === input.workflowId;

    return Promise.resolve(matches ? version : null);
  }

  findPublishedVersion(input: {
    workflowId: string;
    projectId: string;
    versionId?: string;
  }): Promise<WorkflowVersion | null> {
    const workflow = this.#liveWorkflow({ id: input.workflowId, projectId: input.projectId });
    const id = input.versionId ?? workflow?.publishedId;
    if (!id) return Promise.resolve(null);

    return this.findVersion({ id, workflowId: input.workflowId, projectId: input.projectId });
  }

  createWorkflow(input: PersistWorkflowInput): Promise<WorkflowWithVersion> {
    const now = new Date();
    const workflow: Workflow = {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      icon: input.icon,
      description: input.description,
      latestVersionId: null,
      currentVersionId: null,
      publishedId: null,
      publishedById: null,
      copiedFromWorkflowId: input.copiedFromWorkflowId ?? null,
      isEvaluator: input.isEvaluator ?? false,
      isComponent: input.isComponent ?? false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.workflows.set(workflow.id, workflow);

    return Promise.resolve({ ...workflow, currentVersion: null, latestVersion: null });
  }

  updateWorkflow(input: {
    id: string;
    projectId: string;
    data: Record<string, unknown>;
  }): Promise<Workflow> {
    const workflow = this.#requireWorkflow(input);
    const updated = { ...workflow, ...input.data, updatedAt: new Date() } as Workflow;
    this.store.workflows.set(workflow.id, updated);

    return Promise.resolve(updated);
  }

  createVersion(input: PersistWorkflowVersionInput): Promise<WorkflowVersion> {
    const now = new Date();
    const version: WorkflowVersion = {
      id: input.id,
      workflowId: input.workflowId,
      projectId: input.projectId,
      version: input.version,
      autoSaved: input.autoSaved,
      commitMessage: input.commitMessage,
      authorId: input.authorId ?? null,
      parentId: input.parentId,
      dsl: input.dsl,
      createdAt: now,
      updatedAt: now,
    };
    this.store.versions.set(version.id, version);

    return Promise.resolve(version);
  }

  updateAutoSavedVersion(
    input: PersistWorkflowVersionInput & { id: string },
  ): Promise<WorkflowVersion> {
    const existing = this.store.versions.get(input.id);
    if (!existing) throw new Error(`No workflow version "${input.id}".`);
    const updated: WorkflowVersion = {
      ...existing,
      version: input.version,
      autoSaved: input.autoSaved,
      commitMessage: input.commitMessage,
      authorId: input.authorId ?? existing.authorId,
      parentId: input.parentId,
      dsl: input.dsl,
      updatedAt: new Date(),
    };
    this.store.versions.set(updated.id, updated);

    return Promise.resolve(updated);
  }

  setVersionPointers(input: {
    id: string;
    projectId: string;
    currentVersionId: string;
    latestVersionId?: string | null;
  }): Promise<void> {
    const workflow = this.#requireWorkflow(input);
    this.store.workflows.set(workflow.id, {
      ...workflow,
      currentVersionId: input.currentVersionId,
      ...(input.latestVersionId === undefined ? {} : { latestVersionId: input.latestVersionId }),
      updatedAt: new Date(),
    });

    return Promise.resolve();
  }

  publish(input: {
    id: string;
    projectId: string;
    versionId: string;
    actorId?: string;
  }): Promise<Workflow> {
    const workflow = this.#requireWorkflow(input);
    const published: Workflow = {
      ...workflow,
      publishedId: input.versionId,
      ...(input.actorId ? { publishedById: input.actorId } : {}),
      updatedAt: new Date(),
    };
    this.store.workflows.set(published.id, published);

    return Promise.resolve(published);
  }

  findCopies(input: { workflowId: string; projectId: string }): Promise<Workflow[]> {
    return Promise.resolve(
      [...this.store.workflows.values()].filter(
        (workflow) =>
          workflow.copiedFromWorkflowId === input.workflowId && !workflow.archivedAt,
      ),
    );
  }
}

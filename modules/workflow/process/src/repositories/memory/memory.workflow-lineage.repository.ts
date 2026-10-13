import type {
  Workflow,
  WorkflowCopiesRow,
  WorkflowCopyWithPath,
  WorkflowLineageRow,
  WorkflowPublicationFlags,
  WorkflowProjectPath,
  WorkflowSourceRow,
  WorkflowVersionRow,
} from "@langwatch/workflow-contract";

import { WorkflowLineageRepository } from "../workflow-lineage.repository.ts";
import type { WorkflowMemoryStore } from "./workflow-memory.store.ts";

type WorkflowScope = Readonly<{ workflowId: string; projectId: string }>;

/** The lineage reads over the one memory store; an unknown project path names only its id. */
export class WorkflowLineageMemoryRepository extends WorkflowLineageRepository {
  static create(store: WorkflowMemoryStore): WorkflowLineageMemoryRepository {
    return new WorkflowLineageMemoryRepository(store);
  }

  private constructor(private readonly store: WorkflowMemoryStore) {
    super();
  }

  async findWithCopyLineage(input: { projectId: string }): Promise<readonly WorkflowLineageRow[]> {
    return this.store
      .workflowsOf(input.projectId)
      .filter((workflow) => workflow.archivedAt === null)
      .map((workflow) => {
        const source = this.#sourceOf(workflow);
        return {
          ...workflow,
          copiedFrom: source ? this.#withPath(source) : null,
          copiedWorkflows: this.#copiesOf(workflow).map(({ projectId }) => ({ projectId })),
        };
      });
  }

  async findWorkflow(input: WorkflowScope): Promise<Readonly<{ projectId: string }> | null> {
    const workflow = this.#live(input);
    return workflow ? { projectId: workflow.projectId } : null;
  }

  async findCopiesWithPath(input: WorkflowScope): Promise<readonly WorkflowCopyWithPath[] | null> {
    const workflow = this.#scoped(input);
    return workflow ? this.#copiesOf(workflow).map((copy) => this.#withPath(copy)) : null;
  }

  async findWorkflowWithSource(input: WorkflowScope): Promise<WorkflowSourceRow | null> {
    const workflow = this.#live(input);
    if (!workflow) return null;
    const source = this.#sourceOf(workflow);

    return {
      ...this.#withLatestVersion(workflow),
      copiedFrom: source ? this.#withLatestVersion(source) : null,
    };
  }

  async findWorkflowWithCopies(input: WorkflowScope): Promise<WorkflowCopiesRow | null> {
    const workflow = this.#live(input);
    if (!workflow) return null;

    return {
      ...this.#withLatestVersion(workflow),
      copiedWorkflows: this.#copiesOf(workflow).map((copy) => this.#withLatestVersion(copy)),
    };
  }

  async findLatestVersionNumber(
    input: WorkflowScope,
  ): Promise<Readonly<{ version: string | null }> | null> {
    const workflow = this.#scoped(input);
    return workflow ? { version: this.#latestVersionOf(workflow)?.version ?? null } : null;
  }

  async findFlags(input: WorkflowScope): Promise<WorkflowPublicationFlags | null> {
    const workflow = this.#scoped(input);
    if (!workflow) return null;
    const { id, name, publishedId, isComponent, isEvaluator } = workflow;

    return { id, name, publishedId, isComponent, isEvaluator };
  }

  async findVersion(input: {
    versionId: string;
    projectId: string;
  }): Promise<Readonly<Record<string, unknown>> | null> {
    const version = this.store.versions.get(input.versionId);
    return version?.projectId === input.projectId ? { ...version } : null;
  }

  async setFlags(
    input: WorkflowScope & { isComponent?: boolean; isEvaluator?: boolean },
  ): Promise<void> {
    const workflow = this.#scoped(input);
    if (!workflow) return;
    this.store.workflows.set(workflow.id, {
      ...workflow,
      ...(input.isComponent === undefined ? {} : { isComponent: input.isComponent }),
      ...(input.isEvaluator === undefined ? {} : { isEvaluator: input.isEvaluator }),
    });
  }

  async findPublishedComponents(input: {
    projectId: string;
  }): Promise<readonly (Workflow & { versions: readonly unknown[] })[]> {
    return this.store
      .workflowsOf(input.projectId)
      .filter((workflow) => workflow.isComponent || workflow.isEvaluator)
      .map((workflow) => ({
        ...workflow,
        versions: this.store
          .versionsOf({ workflowId: workflow.id, projectId: workflow.projectId })
          .filter((version) => version.id === workflow.publishedId),
      }));
  }

  #scoped(input: WorkflowScope): Workflow | undefined {
    const workflow = this.store.workflows.get(input.workflowId);
    return workflow?.projectId === input.projectId ? workflow : undefined;
  }

  #live(input: WorkflowScope): Workflow | undefined {
    const workflow = this.#scoped(input);
    return workflow?.archivedAt === null ? workflow : undefined;
  }

  #sourceOf(workflow: Workflow): Workflow | undefined {
    return workflow.copiedFromWorkflowId
      ? this.store.workflows.get(workflow.copiedFromWorkflowId)
      : undefined;
  }

  #copiesOf(workflow: Workflow): Workflow[] {
    return [...this.store.workflows.values()].filter(
      (copy) => copy.copiedFromWorkflowId === workflow.id && copy.archivedAt === null,
    );
  }

  #latestVersionOf(workflow: Workflow): WorkflowVersionRow | null {
    const version = workflow.latestVersionId
      ? this.store.versions.get(workflow.latestVersionId)
      : undefined;
    return version ? { version: version.version, dsl: version.dsl } : null;
  }

  #withLatestVersion(workflow: Workflow): Workflow & { latestVersion: WorkflowVersionRow | null } {
    return { ...workflow, latestVersion: this.#latestVersionOf(workflow) };
  }

  #withPath(workflow: Workflow): WorkflowCopyWithPath {
    return {
      id: workflow.id,
      name: workflow.name,
      projectId: workflow.projectId,
      project: this.store.projectPaths.get(workflow.projectId) ?? unnamedPath(workflow.projectId),
    };
  }
}

function unnamedPath(projectId: string): WorkflowProjectPath {
  return {
    id: projectId,
    name: projectId,
    team: { id: "", name: "", organization: { id: "", name: "" } },
  };
}

import { WorkflowNotFoundError, type WorkflowApi } from "@langwatch/workflow-contract";

import { ExperimentWorkflowDsl } from "./experiment-execution-data.service.ts";

type WorkflowReads = Pick<WorkflowApi, "getById" | "getVersionHistory">;

/** The workflow rows and versions a run reads, answered by the module that owns them. */
export class ExperimentWorkflowSourceService extends ExperimentWorkflowDsl {
  static create(workflows: WorkflowReads): ExperimentWorkflowSourceService {
    return new ExperimentWorkflowSourceService(workflows);
  }

  private constructor(private readonly workflows: WorkflowReads) {
    super();
  }

  async findWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ id: string; name: string; publishedId: string | null } | null> {
    const workflow = await this.#find(input);
    if (!workflow) return null;

    return { id: workflow.id, name: workflow.name, publishedId: workflow.publishedId };
  }

  async findVersionDsl(input: {
    projectId: string;
    workflowId: string;
    versionId: string;
  }): Promise<unknown> {
    const versions = await this.#versions(input);

    return versions.find((version) => version.id === input.versionId)?.dsl ?? null;
  }

  async findEvaluableWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ id: string; name: string } | null> {
    const workflow = await this.#find(input);
    if (!workflow || workflow.archivedAt) return null;

    return { id: workflow.id, name: workflow.name };
  }

  async findEvaluableVersion(input: {
    projectId: string;
    workflowId: string;
    versionId?: string;
  }): Promise<{ id: string; version: string; dsl: unknown } | null> {
    const versions = await this.#versions(input);
    const chosen = input.versionId
      ? versions.find((version) => version.id === input.versionId)
      : (versions.find((version) => !version.autoSaved) ?? versions[0]);
    if (!chosen?.dsl) return null;

    return { id: chosen.id, version: chosen.version, dsl: chosen.dsl };
  }

  async #find(input: { projectId: string; workflowId: string }) {
    try {
      return await this.workflows.getById({ id: input.workflowId, projectId: input.projectId });
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return null;
      throw error;
    }
  }

  async #versions(input: { projectId: string; workflowId: string }) {
    try {
      return await this.workflows.getVersionHistory({
        workflowId: input.workflowId,
        projectId: input.projectId,
        mode: "allDsl",
      });
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return [];
      throw error;
    }
  }
}

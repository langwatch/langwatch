/**
 * Whether everything a workbench state points at still exists, and keeping the dataset
 * versions it pins out of retention.
 */

import type { AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { EvaluatorNotFoundError, type EvaluatorApi } from "@langwatch/evaluator-contract";
import type { parseWorkbenchState } from "@langwatch/experiment-contract";
import {
  collectWorkbenchReferences,
  WorkbenchMissingReferenceError,
} from "@langwatch/experiment-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { WorkflowNotFoundError, type WorkflowApi } from "@langwatch/workflow-contract";

export type ExperimentWorkbenchReferenceServices = {
  prompts: PromptApi;
  agents: AgentApi;
  evaluators: EvaluatorApi;
  workflows: WorkflowApi;
  dataset: DatasetApi;
};

type ReferenceType = "prompt" | "agent" | "evaluator" | "workflow" | "dataset";

export class ExperimentWorkbenchReferencesService {
  private constructor(private readonly references: ExperimentWorkbenchReferenceServices) {}

  static create(options: {
    references: ExperimentWorkbenchReferenceServices;
  }): ExperimentWorkbenchReferencesService {
    return new ExperimentWorkbenchReferencesService(options.references);
  }

  async assertAllExist({
    projectId,
    state,
  }: {
    projectId: string;
    state: ReturnType<typeof parseWorkbenchState>;
  }): Promise<void> {
    const references = collectWorkbenchReferences(state);
    // Read once for the whole state: a workbench naming twenty prompts would
    // otherwise be twenty round trips to the same list.
    const prompts = references.has("prompt")
      ? await this.references.prompts.getAllPrompts({ projectId, version: "latest" })
      : [];

    for (const [type, ids] of references) {
      for (const id of ids) {
        const exists = await this.exists({ projectId, type, id, prompts });
        if (!exists) {
          throw new WorkbenchMissingReferenceError({ refType: type, refId: id });
        }
      }
    }
  }

  /** Marks every dataset version the state pins, so retention never thins one it will run. */
  async pinDatasetVersions({
    projectId,
    state,
  }: {
    projectId: string;
    state: ReturnType<typeof parseWorkbenchState>;
  }): Promise<void> {
    for (const dataset of state.datasets) {
      if (dataset.type !== "saved" || !dataset.datasetId || !dataset.datasetVersion) continue;
      await this.references.dataset.pinVersion({
        projectId,
        datasetId: dataset.datasetId,
        version: dataset.datasetVersion,
      });
    }
  }

  private async exists({
    projectId,
    type,
    id,
    prompts,
  }: {
    projectId: string;
    type: ReferenceType;
    id: string;
    prompts: Awaited<ReturnType<PromptApi["getAllPrompts"]>>;
  }): Promise<boolean> {
    switch (type) {
      case "prompt":
        return prompts.some((prompt) => prompt.id === id || prompt.handle === id);
      case "agent":
        return this.references.agents.exists({ id, projectId });
      case "dataset":
        return (
          (await this.references.dataset.getByIds({ projectId, datasetIds: [id] })).length === 1
        );
      case "evaluator":
        return this.references.evaluators
          .getById({ id, projectId })
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof EvaluatorNotFoundError) {
              return false;
            }

            throw error;
          });
      case "workflow":
        return this.references.workflows
          .getById({ id, projectId })
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof WorkflowNotFoundError) {
              return false;
            }

            throw error;
          });
    }
  }
}

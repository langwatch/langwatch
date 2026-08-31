/**
 * Whether everything a workbench state points at still exists.
 *
 * A workbench state names prompts, agents, evaluators, workflows and
 * datasets by id. Saving one whose references have since been deleted would
 * store a configuration that cannot run, and the customer would not find out
 * until they pressed the button — by which point the edit that broke it is
 * several saves back. So the save is refused, naming the type and the id.
 *
 * Each feature answers "does this exist" in its own way, and two of them do it
 * by throwing. Their not-found errors are caught and turned into `false`;
 * anything else is rethrown, because a workflow service that is DOWN must not
 * read as a workflow that is GONE.
 */

import type { AgentService } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import { EvaluatorNotFoundError, type EvaluatorService } from "@langwatch/evaluator-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import { WorkflowNotFoundError, type WorkflowService } from "@langwatch/workflow-contract";
import {
  collectWorkbenchReferences,
  WorkbenchMissingReferenceError,
  parseWorkbenchState,
} from "@langwatch/experiment-contract";

export type ExperimentWorkbenchReferenceServices = {
  prompts: PromptService;
  agents: AgentService;
  evaluators: EvaluatorService;
  workflows: WorkflowService;
  dataset: DatasetService;
};

type ReferenceType = "prompt" | "agent" | "evaluator" | "workflow" | "dataset";

export class ExperimentWorkbenchReferencesService {
  constructor(private readonly references: ExperimentWorkbenchReferenceServices) {}

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
        if (!exists) throw new WorkbenchMissingReferenceError({ refType: type, refId: id });
      }
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
    prompts: Awaited<ReturnType<PromptService["getAllPrompts"]>>;
  }): Promise<boolean> {
    switch (type) {
      case "prompt":
        return prompts.some((prompt) => prompt.id === id || prompt.handle === id);
      case "agent":
        return await this.references.agents.exists({ id, projectId });
      case "dataset":
        return (
          (await this.references.dataset.getByIds({ projectId, datasetIds: [id] })).length === 1
        );
      case "evaluator":
        return await this.references.evaluators
          .getById({ id, projectId })
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof EvaluatorNotFoundError) return false;
            throw error;
          });
      case "workflow":
        return await this.references.workflows
          .getById({ id, projectId })
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof WorkflowNotFoundError) return false;
            throw error;
          });
    }
  }
}

import { newEvaluatorId, type Evaluator } from "@langwatch/evaluator-contract";
import { WorkflowNotFoundError, type WorkflowApi } from "@langwatch/workflow-contract";

import type { EvaluatorCreationCapService } from "./evaluator-creation-cap.service.ts";
import type { EvaluatorService } from "./evaluator.service.ts";

/**
 * The Optimization Studio's evaluator switch: workflow keeps the flags, this module the
 * evaluator that wraps a workflow published as one (round 26, CD-2).
 * Spec: modules/evaluator/specs/evaluator-service.feature
 */
export class EvaluatorWorkflowPublicationService {
  static create(deps: {
    workflows: Pick<WorkflowApi, "findWorkflowFlags" | "setWorkflowFlags">;
    evaluators: Pick<EvaluatorService, "findByWorkflow" | "create" | "update" | "archive">;
    creationCaps: Pick<EvaluatorCreationCapService, "assertCreationAllowed">;
  }): EvaluatorWorkflowPublicationService {
    return new EvaluatorWorkflowPublicationService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof EvaluatorWorkflowPublicationService.create>[0],
  ) {}

  /** A workflow is an evaluator or a component, never both; refused before any flag changes. */
  async toggleSaveAsEvaluator(input: {
    workflowId: string;
    projectId: string;
    isEvaluator: boolean;
  }): Promise<void> {
    const workflow = await this.deps.workflows.findWorkflowFlags(input);
    if (!workflow) {
      throw new WorkflowNotFoundError(input.workflowId, input.projectId);
    }

    // Saving as an evaluator creates one when none is linked yet, so the
    // plan's evaluator cap is checked before any flag changes.
    if (input.isEvaluator) {
      const [linked] = await this.deps.evaluators.findByWorkflow(input);
      if (!linked)
        await this.deps.creationCaps.assertCreationAllowed({ projectId: input.projectId });
    }

    await this.deps.workflows.setWorkflowFlags({
      workflowId: input.workflowId,
      projectId: input.projectId,
      isEvaluator: input.isEvaluator,
      isComponent: !input.isEvaluator,
    });

    if (input.isEvaluator) {
      await this.#linkToWorkflow({
        workflowId: input.workflowId,
        projectId: input.projectId,
        name: workflow.name,
      });
    }
  }

  /** Nothing keeps an evaluator pointing at a workflow that no longer offers itself as one. */
  async disableAsEvaluator(input: { workflowId: string; projectId: string }): Promise<void> {
    await this.deps.workflows.setWorkflowFlags({ ...input, isEvaluator: false });

    const [linked] = await this.deps.evaluators.findByWorkflow(input);
    if (!linked) return;

    await this.deps.evaluators.archive({ id: linked.id, projectId: input.projectId });
  }

  /** Create-or-rename: a republished, renamed workflow must not leave a stale or second row. */
  async #linkToWorkflow(input: {
    workflowId: string;
    projectId: string;
    name: string;
  }): Promise<Evaluator> {
    const { workflowId, projectId, name } = input;
    const [existing] = await this.deps.evaluators.findByWorkflow({ workflowId, projectId });

    if (existing) {
      return this.deps.evaluators.update({ id: existing.id, projectId, data: { name } });
    }

    return this.deps.evaluators.create({
      id: newEvaluatorId(),
      projectId,
      name,
      type: "workflow",
      config: {},
      workflowId,
    });
  }
}

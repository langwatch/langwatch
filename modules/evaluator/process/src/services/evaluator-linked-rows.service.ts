import { EvaluatorWorkflowVersionRequiredError } from "@langwatch/evaluator-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

type WorkflowReference = Readonly<{ workflowId: string; projectId: string }>;

/** The workflow rows an evaluator is entangled with, through their owner. */
export class EvaluatorLinkedRowsService {
  private constructor(private readonly workflows: WorkflowApi) {}

  static create({ workflows }: { workflows: WorkflowApi }): EvaluatorLinkedRowsService {
    return new EvaluatorLinkedRowsService(workflows);
  }

  async findLinkedWorkflow({
    workflowId,
    projectId,
  }: WorkflowReference): Promise<{ id: string; name: string } | null> {
    const [linked] = await this.workflows.listSummaries({ projectId, workflowIds: [workflowId] });

    return linked ?? null;
  }

  archiveLinkedWorkflow(input: WorkflowReference): Promise<{ id: string }> {
    return this.workflows.archiveLinked(input);
  }

  /**
   * Refused rather than copied when the graph has no saved version: an
   * evaluator created against one is a structurally broken replica, and the
   * break only shows up when somebody runs it.
   */
  async replicateEvaluatorWorkflow(
    input: Readonly<{
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actorId: string;
    }>,
  ): Promise<string> {
    const workflow = await this.#latestVersionOf({
      workflowId: input.workflowId,
      projectId: input.sourceProjectId,
    });

    const { workflowId: newWorkflowId, dsl } = await this.workflows.copyStudioWorkflow({
      workflow,
      targetProjectId: input.targetProjectId,
      sourceProjectId: input.sourceProjectId,
      copiedFromWorkflowId: input.workflowId,
    });

    try {
      await this.workflows.saveStudioVersion(
        {
          projectId: input.targetProjectId,
          workflowId: newWorkflowId,
          dsl,
          autoSaved: false,
          commitMessage: "Copied from " + workflow.name,
        },
        { id: input.actorId },
      );
    } catch (saveError) {
      await this.deleteReplicatedWorkflow({
        workflowId: newWorkflowId,
        projectId: input.targetProjectId,
      }).catch(() => void 0);

      throw saveError;
    }

    return newWorkflowId;
  }

  deleteReplicatedWorkflow(input: WorkflowReference): Promise<void> {
    return this.workflows.deleteUncommitted(input);
  }

  async #latestVersionOf({ workflowId, projectId }: WorkflowReference) {
    const [linked] = await this.workflows.listSummaries({ projectId, workflowIds: [workflowId] });
    if (!linked) throw new EvaluatorWorkflowVersionRequiredError(workflowId);

    const workflow = await this.workflows.getById({
      id: workflowId,
      projectId,
      includeVersion: true,
    });
    const dsl = workflow.latestVersion?.dsl;
    if (!dsl) throw new EvaluatorWorkflowVersionRequiredError(workflowId);

    return {
      id: workflow.id,
      name: workflow.name,
      icon: workflow.icon,
      description: workflow.description,
      isEvaluator: workflow.isEvaluator,
      isComponent: workflow.isComponent,
      latestVersion: { dsl },
    };
  }
}

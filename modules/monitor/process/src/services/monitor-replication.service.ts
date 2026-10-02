import { newEvaluatorId, type EvaluatorApi } from "@langwatch/evaluator-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

/**
 * Copies a monitor's evaluator and its workflow into another project, and undoes the copy when
 * the replica cannot be written. The copy is `EvaluatorApi.copy`, the same replication
 * `evaluators.copy` itself runs.
 */
export class MonitorReplicationService {
  private constructor(
    private readonly evaluators: Pick<EvaluatorApi, "copy" | "archive">,
    private readonly workflows: Pick<WorkflowApi, "deleteUncommitted">,
  ) {}

  static create(options: {
    evaluators: Pick<EvaluatorApi, "copy" | "archive">;
    workflows: Pick<WorkflowApi, "deleteUncommitted">;
  }): MonitorReplicationService {
    return new MonitorReplicationService(options.evaluators, options.workflows);
  }

  async copyEvaluatorToProject(input: {
    evaluatorId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actor: { id: string };
  }): Promise<{ id: string; workflowId: string | null }> {
    const copied = await this.evaluators.copy({
      evaluatorId: input.evaluatorId,
      projectId: input.targetProjectId,
      sourceProjectId: input.sourceProjectId,
      newEvaluatorId: newEvaluatorId(),
      actorId: input.actor.id,
    });

    return { id: copied.id, workflowId: copied.workflowId };
  }

  /** Undoes the copies made for a replica the monitor insert then refused. */
  async rollback(input: {
    evaluatorId: string | null;
    workflowId: string | null;
    projectId: string;
  }): Promise<void> {
    if (input.evaluatorId) {
      await this.evaluators
        .archive({ id: input.evaluatorId, projectId: input.projectId })
        .catch(() => undefined);
    }

    if (input.workflowId) {
      await this.workflows
        .deleteUncommitted({ workflowId: input.workflowId, projectId: input.projectId })
        .catch(() => undefined);
    }
  }
}

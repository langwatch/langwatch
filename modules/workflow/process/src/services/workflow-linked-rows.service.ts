import type { AgentApi } from "@langwatch/agent-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { WorkflowCascadeArchive } from "@langwatch/workflow-contract";

import type { WorkflowLineageReads } from "../app/workflow.app.ts";
import type { WorkflowService } from "./workflow.service.ts";

type WorkflowScope = Readonly<{ workflowId: string; projectId: string }>;

export type WorkflowLinkedRowsServiceOptions = {
  workflows: Pick<WorkflowService, "archive">;
  agents: Pick<AgentApi, "listWorkflowConfigs" | "getNamesByIds" | "archive">;
  evaluators: Pick<EvaluatorApi, "listByWorkflow" | "archive">;
  monitors: Pick<MonitorApi, "findByEvaluator" | "delete">;
};

/**
 * The agents, evaluators and monitors hanging off a workflow, through their owners. The
 * archive cascade is one owner call at a time, so a failure part way leaves what already
 * ran; each step is safe to repeat.
 */
export class WorkflowLinkedRowsService implements Pick<
  WorkflowLineageReads,
  "listAgents" | "listMonitorsForEvaluators" | "cascadeArchive"
> {
  static create(options: WorkflowLinkedRowsServiceOptions): WorkflowLinkedRowsService {
    return new WorkflowLinkedRowsService(options);
  }

  private constructor(private readonly options: WorkflowLinkedRowsServiceOptions) {}

  async listAgents(
    input: WorkflowScope,
  ): Promise<readonly Readonly<{ id: string; name: string }>[]> {
    const linked = await this.options.agents.listWorkflowConfigs(input);
    if (linked.length === 0) return [];

    return this.options.agents.getNamesByIds({
      ids: linked.map(({ id }) => id),
      projectId: input.projectId,
    });
  }

  async listMonitorsForEvaluators(input: {
    projectId: string;
    evaluatorIds: readonly string[];
  }): Promise<readonly Readonly<{ id: string; name: string; evaluatorId: string }>[]> {
    const perEvaluator = await Promise.all(
      input.evaluatorIds.map(async (evaluatorId) =>
        (
          await this.options.monitors.findByEvaluator({ projectId: input.projectId, evaluatorId })
        ).map(({ id, name }) => ({ id, name, evaluatorId })),
      ),
    );

    return perEvaluator.flat();
  }

  /** Restoring brings back the workflow only; its evaluators and agents stay archived. */
  async cascadeArchive(input: {
    projectId: string;
    workflowId: string;
    unarchive?: boolean;
  }): Promise<WorkflowCascadeArchive> {
    if (input.unarchive) {
      const workflow = await this.options.workflows.archive({
        id: input.workflowId,
        projectId: input.projectId,
        unarchive: true,
      });
      return {
        workflow,
        archivedEvaluatorsCount: 0,
        archivedAgentsCount: 0,
        deletedMonitorsCount: 0,
      };
    }

    const evaluators = await this.options.evaluators.listByWorkflow(input);
    const monitors = await this.listMonitorsForEvaluators({
      projectId: input.projectId,
      evaluatorIds: evaluators.map(({ id }) => id),
    });
    for (const monitor of monitors) {
      await this.options.monitors.delete({ id: monitor.id, projectId: input.projectId });
    }
    for (const evaluator of evaluators) {
      await this.options.evaluators.archive({ id: evaluator.id, projectId: input.projectId });
    }
    const agents = await this.options.agents.listWorkflowConfigs(input);
    for (const agent of agents) {
      await this.options.agents.archive({ id: agent.id, projectId: input.projectId });
    }
    const workflow = await this.options.workflows.archive({
      id: input.workflowId,
      projectId: input.projectId,
    });

    return {
      workflow,
      archivedEvaluatorsCount: evaluators.length,
      archivedAgentsCount: agents.length,
      deletedMonitorsCount: monitors.length,
    };
  }
}

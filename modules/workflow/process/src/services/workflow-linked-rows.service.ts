import type { AgentApi } from "@langwatch/agent-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { WorkflowCascadeArchive } from "@langwatch/workflow-contract";

import type { WorkflowLineageReads } from "../app/workflow.app.ts";
import type { WorkflowService } from "./workflow.service.ts";

type WorkflowScope = Readonly<{ workflowId: string; projectId: string }>;

type WorkflowLinkedRowsServiceOptions = {
  workflows: Pick<WorkflowService, "archive">;
  agents: Pick<AgentApi, "listWorkflowConfigs" | "getNamesByIds" | "archive">;
  monitors: Pick<MonitorApi, "list">;
};

/**
 * The agents and monitors hanging off a workflow, through their owners. The archive cascade
 * takes the agents one call at a time, each safe to repeat; evaluator archives the evaluators
 * from workflow's archived fact, and monitor the monitors from evaluator's (plan §7).
 */
export class WorkflowLinkedRowsService implements Pick<
  WorkflowLineageReads,
  "listAgents" | "listMonitors" | "cascadeArchive"
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

  /** The monitors the workflow's live evaluators back, which go when the evaluators do. */
  async listMonitors(
    input: WorkflowScope,
  ): Promise<readonly Readonly<{ id: string; name: string; evaluatorId: string }>[]> {
    const monitors = await this.options.monitors.list({ projectId: input.projectId });

    return monitors.flatMap(({ id, name, evaluator }) =>
      evaluator?.workflowId === input.workflowId && evaluator.archivedAt === null
        ? [{ id, name, evaluatorId: evaluator.id }]
        : [],
    );
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
      return { workflow, archivedAgentsCount: 0 };
    }

    const agents = await this.options.agents.listWorkflowConfigs(input);
    for (const agent of agents) {
      await this.options.agents.archive({ id: agent.id, projectId: input.projectId });
    }
    const workflow = await this.options.workflows.archive({
      id: input.workflowId,
      projectId: input.projectId,
    });

    return { workflow, archivedAgentsCount: agents.length };
  }
}

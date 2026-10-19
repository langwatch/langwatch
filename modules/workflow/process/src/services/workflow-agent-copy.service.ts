/**
 * Copying an agent into another project: workflow copies a workflow agent's
 * graph, then asks agent to write the copy's row, deleting the graph if that fails.
 * Spec: modules/workflow/specs/workflow-service.feature.
 */
import {
  AgentSourcePermissionDeniedError,
  findLinkedWorkflowIds,
  type AgentApi,
  type AgentApiCopyRequest,
  type AgentCopyCreated,
} from "@langwatch/agent-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { WorkflowCaller } from "@langwatch/workflow-contract";

import type { WorkflowPermissionProbe } from "../app/workflow.app.ts";
import type { WorkflowService } from "./workflow.service.ts";

export type WorkflowAgentCopyServiceOptions = {
  agents: Pick<AgentApi, "getById" | "createCopy">;
  permissions: Pick<WorkflowPermissionProbe, "has">;
  workflows: Pick<WorkflowService, "copy" | "deleteUncommitted">;
  logger?: Logger;
};

export class WorkflowAgentCopyService {
  readonly #agents: WorkflowAgentCopyServiceOptions["agents"];
  readonly #permissions: WorkflowAgentCopyServiceOptions["permissions"];
  readonly #workflows: WorkflowAgentCopyServiceOptions["workflows"];
  readonly #logger: Logger;

  private constructor({ agents, permissions, workflows, logger }: WorkflowAgentCopyServiceOptions) {
    this.#agents = agents;
    this.#permissions = permissions;
    this.#workflows = workflows;
    this.#logger = logger ?? createLogger("langwatch:workflow:agent-copy");
  }

  static create(options: WorkflowAgentCopyServiceOptions): WorkflowAgentCopyService {
    return new WorkflowAgentCopyService(options);
  }

  /** The declared check covers the target project; the source is probed here, before any read. */
  async copyAgent(input: AgentApiCopyRequest, by: WorkflowCaller): Promise<AgentCopyCreated> {
    const permitted = await this.#permissions.has({
      userId: by.id,
      projectId: input.sourceProjectId,
      permission: "evaluations:manage",
    });
    if (!permitted) throw new AgentSourcePermissionDeniedError();

    const source = await this.#agents.getById({
      id: input.agentId,
      projectId: input.sourceProjectId,
    });
    const [sourceWorkflowId] = findLinkedWorkflowIds(source);
    const workflowId =
      source.type === "workflow" && sourceWorkflowId
        ? await this.#copyGraph({ input, sourceWorkflowId, by })
        : undefined;

    return this.#agents
      .createCopy({
        sourceAgentId: input.agentId,
        sourceProjectId: input.sourceProjectId,
        targetProjectId: input.projectId,
        newAgentId: input.newAgentId,
        workflowId,
      })
      .catch(async (error: unknown) => {
        if (workflowId) await this.#removeGraph({ workflowId, projectId: input.projectId });
        throw error;
      });
  }

  async #copyGraph({
    input,
    sourceWorkflowId,
    by,
  }: {
    input: AgentApiCopyRequest;
    sourceWorkflowId: string;
    by: WorkflowCaller;
  }): Promise<string> {
    const copied = await this.#workflows.copy({
      sourceWorkflowId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.projectId,
      copiedFromWorkflowId: sourceWorkflowId,
      authorId: by.id,
    });

    return copied.workflow.id;
  }

  async #removeGraph(input: { workflowId: string; projectId: string }): Promise<void> {
    await this.#workflows
      .deleteUncommitted(input)
      .catch((error: unknown) =>
        this.#logger.error(
          { error, workflowId: input.workflowId },
          "Failed to remove uncommitted workflow copy",
        ),
      );
  }
}

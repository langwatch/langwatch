import {
  AgentCopiesNotFoundError,
  AgentCopySelectionError,
  AgentIsNotCopyError,
  AgentRegisterOnlyError,
  findLinkedWorkflowIds,
  type CopyAgentCommand,
  type PushAgentCopiesInput,
  type AgentReferenceInput,
  type Agent,
  type AgentCopyCreated,
  type AgentPushToCopies,
  type AgentSyncFromSource,
} from "@langwatch/agent-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type { AgentRepository, AgentCopyRecord } from "../repositories/agent.repository.ts";
import { nextAgentId } from "../rules/agent-id.rules.ts";

export class AgentCopyService {
  #repository: AgentRepository;
  #workflows: WorkflowApi;
  #logger: Logger;

  private constructor(repository: AgentRepository, workflows: WorkflowApi, logger: Logger) {
    this.#repository = repository;
    this.#workflows = workflows;
    this.#logger = logger;
  }

  static create({
    repository,
    workflows,
    logger = createLogger("langwatch:agent:copy"),
  }: {
    repository: AgentRepository;
    workflows: WorkflowApi;
    logger?: Logger;
  }): AgentCopyService {
    return new AgentCopyService(repository, workflows, logger);
  }

  getCopies(input: {
    sourceAgentId: string;
    allowedProjectIds?: string[];
  }): Promise<AgentCopyRecord[]> {
    return this.#repository
      .findCopies(input.sourceAgentId)
      .then((copies) =>
        input.allowedProjectIds
          ? copies.filter((copy) => input.allowedProjectIds?.includes(copy.projectId))
          : copies,
      );
  }

  async copy(input: CopyAgentCommand): Promise<AgentCopyCreated> {
    const source = await this.#repository.getById({
      id: input.sourceAgentId,
      projectId: input.sourceProjectId,
    });
    if (source.type === "connected") throw new AgentRegisterOnlyError();

    const [sourceWorkflowId] = findLinkedWorkflowIds(source);
    let workflowId: string | undefined;
    if (source.type === "workflow" && sourceWorkflowId) {
      const copied = await this.#workflows.copy(
        {
          sourceWorkflowId,
          sourceProjectId: input.sourceProjectId,
          targetProjectId: input.targetProjectId,
          copiedFromWorkflowId: sourceWorkflowId,
        },
        { id: input.actorUserId },
      );
      workflowId = copied.workflow.id;
    }

    const copy = await this.#repository
      .create({
        id: input.newAgentId ?? nextAgentId(),
        projectId: input.targetProjectId,
        name: source.name,
        type: source.type,
        config: source.config,
        workflowId,
        copiedFromAgentId: source.id,
      })
      .catch(async (error: unknown) => {
        if (workflowId) {
          await this.#workflows
            .deleteUncommitted({ workflowId, projectId: input.targetProjectId })
            .catch((rollbackError: unknown) =>
              this.#logger.error(
                { error: rollbackError, workflowId },
                "Failed to remove uncommitted workflow copy",
              ),
            );
        }
        throw error;
      });

    return {
      id: copy.id,
      projectId: copy.projectId,
      name: copy.name,
      copiedFromAgentId: source.id,
    };
  }

  async pushToCopies(input: PushAgentCopiesInput): Promise<AgentPushToCopies> {
    const source = await this.#repository.getById({
      id: input.sourceAgentId,
      projectId: input.sourceProjectId,
    });
    const copies = await this.#repository.findCopies(input.sourceAgentId);
    if (copies.length === 0) throw new AgentCopiesNotFoundError(input.sourceAgentId);

    const selected = input.copyIds
      ? copies.filter((copy) => input.copyIds?.includes(copy.id))
      : copies;
    if (selected.length === 0) throw new AgentCopySelectionError(input.sourceAgentId);

    for (const copy of selected) {
      await this.#repository.updateNameAndConfig({
        id: copy.id,
        projectId: copy.projectId,
        name: source.name,
        config: source.config,
      });
    }

    return { pushedTo: selected.length, selectedCopies: input.copyIds?.length ?? copies.length };
  }

  async getSourceOfCopy(input: AgentReferenceInput): Promise<Agent> {
    const copy = await this.#repository.getById({ id: input.agentId, projectId: input.projectId });
    if (!copy.copiedFromAgentId) throw new AgentIsNotCopyError(input.agentId, input.projectId);

    return this.#repository.getByIdOnly(copy.copiedFromAgentId);
  }

  async syncFromSource(input: AgentReferenceInput): Promise<AgentSyncFromSource> {
    const source = await this.getSourceOfCopy(input);
    await this.#repository.updateNameAndConfig({
      id: input.agentId,
      projectId: input.projectId,
      name: source.name,
      config: source.config,
    });

    return { ok: true as const };
  }
}

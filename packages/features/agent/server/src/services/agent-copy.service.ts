import {
  AgentCopiesNotFoundError,
  AgentCopySelectionError,
  AgentIsNotCopyError,
  AgentRegisterOnlyError,
  AgentSourceNotFoundError,
  type Agent,
  AgentService as AgentServiceContract,
  copyAgentCommandSchema,
  linkedWorkflowId,
} from "@langwatch/agent-contract";
import type { AgentsWorkflowPort } from "../ports/agent.port";
import type { AgentRepository } from "../repositories/agent.repository";

type AgentCopyServiceOptions = {
  repository: AgentRepository;
  workflows: AgentsWorkflowPort;
  generateId: () => string;
  /** The owning service's own read, so a copy and a plain read refuse a missing row alike. */
  getAgent: (input: { id: string; projectId: string }) => Promise<Agent>;
};

/**
 * Copying an agent between projects, and keeping the copies in step with their source.
 */
export class AgentCopyService {
  static create(options: AgentCopyServiceOptions): AgentCopyService {
    return new AgentCopyService(options);
  }

  private constructor(private readonly options: AgentCopyServiceOptions) {}

  private get repository(): AgentRepository {
    return this.options.repository;
  }

  private get workflows(): AgentsWorkflowPort {
    return this.options.workflows;
  }

  private generateId(): string {
    return this.options.generateId();
  }

  private getAgent(input: { id: string; projectId: string }): Promise<Agent> {
    return this.options.getAgent(input);
  }

  async copy(
    input: Parameters<AgentServiceContract["copy"]>[0],
  ): ReturnType<AgentServiceContract["copy"]> {
    const command = copyAgentCommandSchema.parse(input);
    const source = await this.getAgent({
      id: command.sourceAgentId,
      projectId: command.sourceProjectId,
    });
    // A connected agent is a running process that registered itself, and its
    // identity is the pair of that process and its environment. A copy would
    // carry no such process, so it would be a row nothing can ever connect to.
    if (source.type === "connected") {
      throw new AgentRegisterOnlyError();
    }

    let workflowId: string | undefined;
    const sourceWorkflowId = linkedWorkflowId(source);
    if (source.type === "workflow" && sourceWorkflowId) {
      const copiedWorkflow = await this.workflows.copy({
        workflowId: sourceWorkflowId,
        sourceProjectId: command.sourceProjectId,
        targetProjectId: command.targetProjectId,
        actorUserId: command.actorUserId,
      });
      workflowId = copiedWorkflow.workflowId;
    }

    try {
      const copy = await this.repository.create({
        id: command.newAgentId ?? this.generateId(),
        projectId: command.targetProjectId,
        name: source.name,
        type: source.type,
        config: source.config,
        workflowId,
        copiedFromAgentId: source.id,
      });

      return {
        id: copy.id,
        projectId: copy.projectId,
        name: copy.name,
        copiedFromAgentId: source.id,
      };
    } catch (error) {
      if (workflowId) {
        await this.workflows
          .remove({ workflowId, projectId: command.targetProjectId })
          .catch(() => undefined);
      }

      throw error;
    }
  }

  async pushToCopies(
    input: Parameters<AgentServiceContract["pushToCopies"]>[0],
  ): ReturnType<AgentServiceContract["pushToCopies"]> {
    const source = await this.getAgent({
      id: input.sourceAgentId,
      projectId: input.sourceProjectId,
    });
    const copies = await this.repository.findCopies(input.sourceAgentId);
    if (copies.length === 0) {
      throw new AgentCopiesNotFoundError(input.sourceAgentId);
    }

    let selected = copies;
    if (input.copyIds) {
      selected = copies.filter((copy) => input.copyIds?.includes(copy.id));
    }

    if (selected.length === 0) {
      throw new AgentCopySelectionError(input.sourceAgentId);
    }

    for (const copy of selected) {
      await this.repository.updateNameAndConfig({
        id: copy.id,
        projectId: copy.projectId,
        name: source.name,
        config: source.config,
      });
    }

    return {
      pushedTo: selected.length,
      selectedCopies: input.copyIds?.length ?? copies.length,
    };
  }

  async getSourceOfCopy(input: {
    agentId: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["getSourceOfCopy"]> {
    const copy = await this.getAgent({
      id: input.agentId,
      projectId: input.projectId,
    });
    if (!copy.copiedFromAgentId) {
      throw new AgentIsNotCopyError(input.agentId, input.projectId);
    }

    const source = await this.getSourceAgent(copy.copiedFromAgentId);

    return source;
  }

  async syncFromSource(
    input: Parameters<AgentServiceContract["syncFromSource"]>[0],
  ): ReturnType<AgentServiceContract["syncFromSource"]> {
    const copy = await this.getAgent({
      id: input.agentId,
      projectId: input.projectId,
    });
    const source = await this.getSourceOfCopy(input);
    await this.repository.updateNameAndConfig({
      id: copy.id,
      projectId: copy.projectId,
      name: source.name,
      config: source.config,
    });

    return { ok: true as const };
  }

  private async getSourceAgent(id: string): Promise<Agent> {
    const source = await this.repository.tryFindByIdOnly(id);
    if (!source) {
      throw new AgentSourceNotFoundError(id);
    }

    return source;
  }
}

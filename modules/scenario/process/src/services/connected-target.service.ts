import type { AgentApi } from "@langwatch/agent-contract";
import {
  AgentOfflineError,
  AgentOwnerOnlyError,
  parseConnectedReference,
} from "@langwatch/agent-contract";
import type { TargetConfig } from "@langwatch/scenario-contract";

export class ConnectedTargetService {
  static create(agents: AgentApi): ConnectedTargetService {
    return new ConnectedTargetService(agents);
  }

  private constructor(private readonly agents: AgentApi) {}

  async resolve(input: {
    projectId: string;
    target: TargetConfig;
    actorId?: string;
  }): Promise<TargetConfig> {
    if (input.target.type !== "connected") return input.target;

    const reference = parseConnectedReference(input.target.referenceId);
    const candidates = reference
      ? await this.agents.getConnectedByNameAndEnvironment({
          projectId: input.projectId,
          name: reference.name,
          environment: reference.environment,
        })
      : [];
    const candidate = candidates.find(
      (agent) => !agent.ownerUserId || agent.ownerUserId === input.actorId,
    );
    const agentId = candidate?.id ?? candidates[0]?.id ?? input.target.referenceId;
    const agent = await this.agents.getById({
      projectId: input.projectId,
      id: agentId,
      viewerUserId: input.actorId,
    });
    if (agent.type !== "connected") return input.target;
    if (!agent.selectable && agent.ownerUserId) {
      throw new AgentOwnerOnlyError({
        agentId: agent.id,
        agentName: agent.name,
        ownerUserId: agent.ownerUserId,
        ownerName: agent.owner?.name ?? null,
      });
    }
    if (agent.status === "offline") {
      throw new AgentOfflineError({
        agentName: agent.name,
        environment: agent.environment ?? null,
      });
    }

    return { type: "connected", referenceId: agent.id };
  }
}

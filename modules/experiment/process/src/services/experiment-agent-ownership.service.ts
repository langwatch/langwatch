/**
 * Refuses a run against someone else's personal development agent, by agent's own
 * selectability rule and owner names, as scenario's agent test does (ADR-128).
 * @see specs/experiments-v3/connected-agent-target.feature
 */
import { AgentOwnerOnlyError, connectedAgentSelectability } from "@langwatch/agent-contract";
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { RunActor } from "@langwatch/scenario-contract";

/** What the check reads about one agent a run targets, and nothing more. */
export type RunTargetAgent = Pick<Agent, "id" | "name" | "type" | "ownerUserId">;

export class ExperimentAgentOwnershipService {
  static create(agents: Pick<AgentApi, "ownersOf">): ExperimentAgentOwnershipService {
    return new ExperimentAgentOwnershipService(agents);
  }

  private constructor(private readonly agents: Pick<AgentApi, "ownersOf">) {}

  /** Throws `agent_owner_only` naming the first connected agent `actor` may not run. */
  async assertConnectedAgentsRunnable({
    agents,
    actor,
  }: {
    agents: readonly RunTargetAgent[];
    actor: RunActor | undefined;
  }): Promise<void> {
    const foreign = agents.find(
      (agent) =>
        agent.type === "connected" &&
        !connectedAgentSelectability({
          ownerUserId: agent.ownerUserId,
          viewerUserId: actor?.id ?? null,
        }).selectable,
    );
    const ownerUserId = foreign?.ownerUserId;
    if (!foreign || !ownerUserId) return;

    const owners = await this.agents.ownersOf([{ ownerUserId }]);
    throw new AgentOwnerOnlyError({
      agentId: foreign.id,
      agentName: foreign.name,
      ownerUserId,
      ownerName: owners.get(ownerUserId)?.name ?? null,
    });
  }
}

import { AgentNotFoundError, type AgentApi, type HttpAgentConfig } from "@langwatch/agent-contract";
import { dslWithStoredHttpAgentSecrets, httpAgentIdsOf } from "@langwatch/workflow-contract";
import { z } from "zod";

const nodesSchema = z.array(z.unknown());

/** Fills a scenario workflow's saved HTTP agents with the credentials the agents store. */
export class ScenarioWorkflowAgentSecretsService {
  static create(agents: Pick<AgentApi, "getById">): ScenarioWorkflowAgentSecretsService {
    return new ScenarioWorkflowAgentSecretsService(agents);
  }

  private constructor(private readonly agents: Pick<AgentApi, "getById">) {}

  async fill({
    dsl,
    projectId,
  }: {
    dsl: Record<string, unknown>;
    projectId: string;
  }): Promise<Record<string, unknown>> {
    const nodes = nodesSchema.safeParse(dsl.nodes);
    if (!nodes.success) return dsl;

    const stored = new Map<string, HttpAgentConfig>();
    await Promise.all(
      httpAgentIdsOf(nodes.data).map(async (id) => {
        const agent = await this.find({ id, projectId });
        if (agent?.type === "http") stored.set(id, agent.config);
      }),
    );

    return dslWithStoredHttpAgentSecrets({ dsl, stored });
  }

  private async find(input: { id: string; projectId: string }) {
    try {
      return await this.agents.getById(input);
    } catch (error) {
      if (error instanceof AgentNotFoundError) return null;
      throw error;
    }
  }
}

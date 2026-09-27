import type { AgentApi } from "@langwatch/agent-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";

import { ExperimentTargetEntityNames } from "./experiment-workbench-target-names.service.ts";

/** The names of the agents and evaluators a workbench's columns point at, from their owners. */
export class ExperimentTargetEntityNamesService extends ExperimentTargetEntityNames {
  static create(peers: {
    agents: Pick<AgentApi, "getAll">;
    evaluators: Pick<EvaluatorApi, "getAll">;
  }): ExperimentTargetEntityNamesService {
    return new ExperimentTargetEntityNamesService(peers);
  }

  private constructor(
    private readonly peers: {
      agents: Pick<AgentApi, "getAll">;
      evaluators: Pick<EvaluatorApi, "getAll">;
    },
  ) {
    super();
  }

  async findAgentNames({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<Record<string, string>> {
    const agents = await this.peers.agents.getAll({ projectId });
    return namesOf(agents, ids);
  }

  async findEvaluatorNames({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<Record<string, string>> {
    const evaluators = await this.peers.evaluators.getAll({ projectId });
    return namesOf(evaluators, ids);
  }
}

function namesOf(
  rows: readonly { id: string; name: string }[],
  ids: string[],
): Record<string, string> {
  const wanted = new Set(ids);
  return Object.fromEntries(
    rows.filter((row) => wanted.has(row.id)).map((row) => [row.id, row.name]),
  );
}

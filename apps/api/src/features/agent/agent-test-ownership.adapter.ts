import type { RunActor } from "@langwatch/scenario-contract";
import { AgentTestOwnershipPort, type AgentTestOwnershipSubject } from "@langwatch/scenario-server";
import { assertConnectedAgentsRunnable } from "@langwatch/suite-server";

/** Joins scenario's ownership port to suite's rule; neither package may import the other. */
export class ApiAgentTestOwnershipAdapter extends AgentTestOwnershipPort {
  static create(): ApiAgentTestOwnershipAdapter {
    return new ApiAgentTestOwnershipAdapter();
  }

  assertRunnable(input: {
    agents: readonly AgentTestOwnershipSubject[];
    actor: RunActor | undefined;
  }): Promise<void> {
    return assertConnectedAgentsRunnable({ agents: input.agents, actor: input.actor });
  }
}

import { AgentApp } from "@langwatch/agent-server";
import { LegacyAgentsRestApi } from "@langwatch/agent-server/legacy-rest";
import type { AgentsRuntimeContext } from "../features/agents";
import { AgentsFeature } from "../features/agents";

export class LegacyAgentsRestFeature {
  static create(context: AgentsRuntimeContext): LegacyAgentsRestApi {
    // The facade dispatches through the feature's application, not its
    // service: the two doors share one description of what an agent
    // operation is, and only the application carries it.
    return LegacyAgentsRestApi.create(
      AgentApp.create({ agents: AgentsFeature.create(context) }),
    );
  }
}

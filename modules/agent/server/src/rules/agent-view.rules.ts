import {
  linkedWorkflowId,
  type Agent,
  type AgentFields,
  type AgentWithFields,
  type ConnectedAgentConfig,
} from "@langwatch/agent-contract";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";

/** The parameters a connected agent declares; every other type declares none. */
export function declaredAgentParameters(
  agent: Pick<Agent, "type" | "config">,
): ScenarioParameterDefinition[] {
  if (agent.type !== "connected") {
    return [];
  }

  return (agent.config as ConnectedAgentConfig).parameters;
}

/** The agent with its workflow's input and output fields folded in, where it has one. */
export function agentWithResolvedFields(
  agent: Agent,
  fields: Record<string, AgentFields>,
): AgentWithFields {
  if (agent.type !== "workflow") {
    return {
      ...agent,
      inputFields: agent.config.inputs ?? [],
      outputFields: agent.config.outputs ?? [],
      fieldsResolved: true,
    };
  }

  const workflowId = linkedWorkflowId(agent);
  if (workflowId && fields[workflowId]) {
    return { ...agent, ...fields[workflowId] };
  }

  return {
    ...agent,
    inputFields: [],
    outputFields: [],
    fieldsResolved: false,
  };
}

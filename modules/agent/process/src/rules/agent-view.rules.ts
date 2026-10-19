import {
  findLinkedWorkflowIds,
  type Agent,
  type AgentWithFields,
  type ConnectedAgentConfig,
  type WorkflowAgentConfig,
  workflowAgentFieldsSchema,
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
export function agentWithResolvedFields(agent: Agent): AgentWithFields {
  if (agent.type !== "workflow") {
    return {
      ...agent,
      inputFields: "inputs" in agent.config ? (agent.config.inputs ?? []) : [],
      outputFields: "outputs" in agent.config ? (agent.config.outputs ?? []) : [],
      fieldsResolved: true,
    };
  }

  const [workflowId] = findLinkedWorkflowIds(agent);
  const stored = workflowAgentFieldsSchema.safeParse(
    (agent.config as WorkflowAgentConfig).workflowFields,
  ).data;
  if (workflowId && stored) {
    const { inputFields, outputFields, fieldsResolved } = stored;
    return { ...agent, inputFields, outputFields, fieldsResolved };
  }

  return {
    ...agent,
    inputFields: [],
    outputFields: [],
    fieldsResolved: false,
  };
}

/** An edited workflow agent's config keeps the fields workflow recorded while its graph stays. */
export function workflowFieldsKeepingStored({
  stored,
  incoming,
}: {
  stored: WorkflowAgentConfig;
  incoming: WorkflowAgentConfig;
}): WorkflowAgentConfig {
  const { workflowFields: _ignored, ...config } = incoming;
  return stored.workflow_id === incoming.workflow_id && stored.workflowFields
    ? { ...config, workflowFields: stored.workflowFields }
    : config;
}

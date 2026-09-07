import {
  linkedWorkflowId,
  type Agent,
  type AgentFields,
  type AgentWithFields,
  type ConnectedAgentConfig,
} from "@langwatch/agent-contract";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";

/**
 * One agent as the REST list and read answer it: the row, plus the identity
 * and the declared parameters of a connected agent, absent on the others.
 */
export type AgentListRow = {
  id: string;
  name: string;
  type: string;
  config: Agent["config"];
  environment: string | null;
  ownerUserId: string | null;
  hostLabel: string | null;
  lastSeenAt: NonNullable<Agent["lastSeenAt"]> | null;
  parameters: ScenarioParameterDefinition[];
  createdAt: Agent["createdAt"];
  updatedAt: Agent["updatedAt"];
};

/**
 * Whether Prisma refused a write because a unique index already holds the
 * value. The row the caller wanted exists, written by somebody else.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/** The parameters a connected agent declares; every other type declares none. */
export function declaredAgentParameters(
  agent: Pick<Agent, "type" | "config">,
): ScenarioParameterDefinition[] {
  if (agent.type !== "connected") {
    return [];
  }

  return (agent.config as ConnectedAgentConfig).parameters;
}

/** One agent as the REST list and read answer it. */
export function agentListRowOf(agent: Agent): AgentListRow {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    config: agent.config,
    environment: agent.environment ?? null,
    ownerUserId: agent.ownerUserId ?? null,
    hostLabel: agent.hostLabel ?? null,
    lastSeenAt: agent.lastSeenAt ?? null,
    parameters: declaredAgentParameters(agent),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
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

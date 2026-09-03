import { getAgent as apiGetAgent, type AgentParameterSpec } from "../langwatch-api-agents.js";

export const describeParameter = ({
  name,
  type,
  options,
  default: defaultValue,
  description,
  required,
}: AgentParameterSpec): string => {
  const parts: string[] = [type];
  if (options?.length) parts.push(`one of ${options.join(", ")}`);
  if (defaultValue !== undefined) parts.push(`default ${JSON.stringify(defaultValue)}`);
  if (required) parts.push("required");
  const suffix = description ? `: ${description}` : "";
  return `- **${name}** (${parts.join(", ")})${suffix}`;
};

/**
 * Handles the platform_get_agent MCP tool invocation.
 *
 * @see specs/mcp-server/agent-tools.feature
 */
export async function handleGetAgent({ id }: { id: string }): Promise<string> {
  const agent = await apiGetAgent(id);

  const lines: string[] = [];
  lines.push(`# ${agent.name}\n`);
  lines.push(`**ID**: ${agent.id}`);
  lines.push(`**Type**: ${agent.type}`);
  if (agent.environment) lines.push(`**Environment**: ${agent.environment}`);
  if (agent.status) lines.push(`**Status**: ${agent.status}`);
  if (agent.owner?.name) lines.push(`**Owner**: ${agent.owner.name}`);
  else if (agent.hostLabel) lines.push(`**Host**: ${agent.hostLabel}`);
  if (agent.lastSeenAt) lines.push(`**Last seen**: ${agent.lastSeenAt}`);
  lines.push(`**Created**: ${agent.createdAt}`);
  lines.push(`**Updated**: ${agent.updatedAt}`);

  if (agent.parameters && agent.parameters.length > 0) {
    lines.push("\n## Parameters\n");
    for (const parameter of agent.parameters) lines.push(describeParameter(parameter));
  }

  if (agent.instances && agent.instances.length > 0) {
    lines.push(`\n## Instances (${agent.instances.length})\n`);
    for (const instance of agent.instances) {
      const label = instance.label ? ` (${instance.label})` : "";
      lines.push(`- ${instance.hostname || instance.id}${label}, connected ${instance.connectedAt}`);
    }
  }

  if (agent.config && Object.keys(agent.config).length > 0) {
    lines.push("\n## Config\n");
    lines.push("```json");
    lines.push(JSON.stringify(agent.config, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}

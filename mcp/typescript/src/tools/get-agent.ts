import { getAgent as apiGetAgent, type AgentParameterSpec } from "../langwatch-api-agents.js";

/** One parameter on one line: name, type, options, default and whether it is required. */
export const describeParameter = (parameter: AgentParameterSpec): string => {
  const parts: string[] = [parameter.type];
  if (parameter.options?.length) parts.push(`one of ${parameter.options.join(", ")}`);
  if (parameter.default !== undefined) parts.push(`default ${JSON.stringify(parameter.default)}`);
  if (parameter.required) parts.push("required");
  const description = parameter.description ? `: ${parameter.description}` : "";
  return `- **${parameter.name}** (${parts.join(", ")})${description}`;
};

/**
 * Handles the platform_get_agent MCP tool invocation.
 *
 * @see specs/mcp-server/agent-tools.feature
 */
export async function handleGetAgent(params: { id: string }): Promise<string> {
  const agent = await apiGetAgent(params.id);

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

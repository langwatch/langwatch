import { listAgents as apiListAgents, type AgentSummary } from "../langwatch-api-agents.js";

/** Who a personal or host-scoped agent belongs to, empty for a shared one. */
export const agentOwnerLabel = (agent: AgentSummary): string =>
  agent.owner?.name ?? agent.hostLabel ?? "";

/**
 * Handles the platform_list_agents MCP tool invocation.
 *
 * @see specs/mcp-server/agent-tools.feature
 */
export async function handleListAgents(): Promise<string> {
  const result = await apiListAgents({ limit: 100 });
  const agents = result.data;

  if (!Array.isArray(agents) || agents.length === 0) {
    return "No agents found in this project.\n\n> Tip: connect one from code with `connectAgent` (TypeScript, `langwatch/agent`) or `connect_agent` (Python), or use `platform_create_agent` for an HTTP agent.";
  }

  const lines: string[] = [];
  lines.push(`# Agents (${result.pagination.total} total)\n`);

  for (const a of agents) {
    lines.push(`## ${a.name}`);
    lines.push(`**ID**: ${a.id}`);
    lines.push(`**Type**: ${a.type}`);
    if (a.environment) lines.push(`**Environment**: ${a.environment}`);
    if (a.status) lines.push(`**Status**: ${a.status}`);
    if (a.instances) lines.push(`**Instances**: ${a.instances.length}`);
    const owner = agentOwnerLabel(a);
    if (owner) lines.push(`**Owner**: ${owner}`);
    lines.push(`**Updated**: ${a.updatedAt}`);
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_agent` with the ID to see full agent details including parameters, instances and config.",
  );

  return lines.join("\n");
}

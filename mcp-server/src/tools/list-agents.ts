import { listAgents as apiListAgents } from "../langwatch-api-agents.js";

export async function handleListAgents(): Promise<string> {
  const result = await apiListAgents({ limit: 100 });
  const agents = result.data;

  if (!Array.isArray(agents) || agents.length === 0) {
    return "No agents found in this project.\n\n> Tip: Use `platform_create_agent` to create your first agent.";
  }

  const lines: string[] = [];
  lines.push(`# Agents (${result.pagination.total} total)\n`);

  for (const a of agents) {
    lines.push(`## ${a.name}`);
    lines.push(`**ID**: ${a.id}`);
    lines.push(`**Type**: ${a.type}`);
    lines.push(`**Updated**: ${a.updatedAt}`);
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_agent` with the ID to see full agent details including config.",
  );

  return lines.join("\n");
}

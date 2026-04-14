import { getAgent as apiGetAgent } from "../langwatch-api-agents.js";

export async function handleGetAgent(params: { id: string }): Promise<string> {
  const agent = await apiGetAgent(params.id);

  const lines: string[] = [];
  lines.push(`# ${agent.name}\n`);
  lines.push(`**ID**: ${agent.id}`);
  lines.push(`**Type**: ${agent.type}`);
  lines.push(`**Created**: ${agent.createdAt}`);
  lines.push(`**Updated**: ${agent.updatedAt}`);

  if (agent.config && Object.keys(agent.config).length > 0) {
    lines.push("\n## Config\n");
    lines.push("```json");
    lines.push(JSON.stringify(agent.config, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}

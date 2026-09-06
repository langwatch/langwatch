import { createAgent as apiCreateAgent } from "../langwatch-api-agents.js";

export async function handleCreateAgent(params: {
  name: string;
  type: string;
  config?: Record<string, unknown>;
}): Promise<string> {
  const agent = await apiCreateAgent({
    name: params.name,
    type: params.type,
    config: params.config ?? {},
  });

  return `Agent created successfully!\n\n**Name**: ${agent.name}\n**ID**: ${agent.id}\n**Type**: ${agent.type}`;
}

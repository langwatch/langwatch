import { updateAgent as apiUpdateAgent } from "../langwatch-api-agents.js";

export async function handleUpdateAgent(params: {
  id: string;
  name?: string;
  type?: string;
  config?: Record<string, unknown>;
}): Promise<string> {
  const { id, ...data } = params;
  const agent = await apiUpdateAgent({ id, ...data });

  return `Agent updated successfully!\n\n**Name**: ${agent.name}\n**ID**: ${agent.id}\n**Type**: ${agent.type}`;
}

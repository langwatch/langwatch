import { deleteAgent as apiDeleteAgent } from "../langwatch-api-agents.ts";

export async function handleDeleteAgent(params: { id: string }): Promise<string> {
  const result = await apiDeleteAgent(params.id);

  return `Agent archived successfully!\n\n**Name**: ${result.name}\n**ID**: ${result.id}`;
}

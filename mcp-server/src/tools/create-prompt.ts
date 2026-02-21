import { createPrompt as apiCreatePrompt } from "../langwatch-api.js";

/**
 * Handles the platform_create_prompt MCP tool invocation.
 *
 * Creates a new prompt in the LangWatch project and returns a
 * confirmation with the created prompt's details.
 */
export async function handleCreatePrompt(params: {
  name: string;
  handle?: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  modelProvider: string;
  description?: string;
}): Promise<string> {
  const result = await apiCreatePrompt(params);

  const lines: string[] = [];
  lines.push("Prompt created successfully!\n");
  if (result.id) lines.push(`**ID**: ${result.id}`);
  if (result.handle) lines.push(`**Handle**: ${result.handle}`);
  lines.push(`**Name**: ${result.name || params.name}`);
  lines.push(`**Model**: ${params.model} (${params.modelProvider})`);
  if (result.latestVersionNumber != null)
    lines.push(`**Version**: v${result.latestVersionNumber}`);

  return lines.join("\n");
}

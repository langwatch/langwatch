import { updatePrompt as apiUpdatePrompt } from "../langwatch-api.js";

/**
 * Handles the platform_update_prompt MCP tool invocation.
 *
 * Updates an existing prompt via the PUT endpoint.
 * Every update with a commitMessage creates a new version automatically.
 */
export async function handleUpdatePrompt(params: {
  idOrHandle: string;
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  commitMessage: string;
  tags?: string[];
}): Promise<string> {
  const { idOrHandle, ...data } = params;

  const result = await apiUpdatePrompt(idOrHandle, data);

  const lines: string[] = [];
  lines.push("Prompt updated successfully!\n");
  if (result.id) lines.push(`**ID**: ${result.id}`);
  if (result.handle) lines.push(`**Handle**: ${result.handle}`);
  if (result.latestVersionNumber != null)
    lines.push(`**Version**: v${result.latestVersionNumber}`);
  lines.push(`**Commit**: ${params.commitMessage}`);
  if (params.tags && params.tags.length > 0)
    lines.push(`**Tags**: ${params.tags.join(", ")}`);

  return lines.join("\n");
}

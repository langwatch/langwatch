import { createPrompt as apiCreatePrompt } from "../langwatch-api.js";

/**
 * Converts a human-readable name into a URL-friendly handle.
 *
 * Lowercases the input, replaces non-alphanumeric runs with hyphens,
 * and strips leading/trailing hyphens so the result satisfies the
 * backend's handleSchema regex (`/^[a-z0-9_-]+$/`).
 */
function toHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

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
}): Promise<string> {
  const handle = params.handle || toHandle(params.name);

  const result = await apiCreatePrompt({
    handle,
    messages: params.messages,
    model: params.model,
  });

  const lines: string[] = [];
  lines.push("Prompt created successfully!\n");
  if (result.id) lines.push(`**ID**: ${result.id}`);
  if (result.handle) lines.push(`**Handle**: ${result.handle}`);
  lines.push(`**Name**: ${result.name || params.name}`);
  lines.push(`**Model**: ${params.model}`);
  if (result.latestVersionNumber != null)
    lines.push(`**Version**: v${result.latestVersionNumber}`);

  return lines.join("\n");
}

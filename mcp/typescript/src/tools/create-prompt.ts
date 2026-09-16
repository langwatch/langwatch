import { createPrompt as apiCreatePrompt } from "../langwatch-api.js";

const HANDLE_PATTERN = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/;

/**
 * Converts a human-readable name into a URL-friendly handle: lowercased,
 * non-alphanumeric runs replaced with hyphens, leading/trailing hyphens
 * stripped. May return empty — callers must validate.
 */
function toHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Handles the platform_create_prompt MCP tool: creates a prompt and returns its details. */
export async function handleCreatePrompt(params: {
  name: string;
  handle?: string;
  messages: { role: string; content: string }[];
  model: string;
  tags?: string[];
}): Promise<string> {
  const handle = params.handle?.trim() || toHandle(params.name);
  if (!handle || !HANDLE_PATTERN.test(handle)) {
    throw new Error(
      `Invalid prompt handle "${handle || ""}". Handle must match ${HANDLE_PATTERN}. Provide a valid \`handle\` explicitly.`,
    );
  }

  const result = await apiCreatePrompt({
    handle,
    messages: params.messages,
    model: params.model,
    ...(params.tags ? { tags: params.tags } : {}),
  });

  const lines: string[] = [];
  lines.push("Prompt created successfully!\n");
  if (result.id) lines.push(`**ID**: ${result.id}`);
  if (result.handle) lines.push(`**Handle**: ${result.handle}`);
  lines.push(`**Name**: ${result.name || params.name}`);
  lines.push(`**Model**: ${params.model}`);
  if (result.latestVersionNumber != null) lines.push(`**Version**: v${result.latestVersionNumber}`);
  if (params.tags && params.tags.length > 0) lines.push(`**Tags**: ${params.tags.join(", ")}`);

  return lines.join("\n");
}

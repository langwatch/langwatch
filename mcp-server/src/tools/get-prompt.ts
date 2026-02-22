import { getPrompt as apiGetPrompt } from "../langwatch-api.js";

/**
 * Handles the platform_get_prompt MCP tool invocation.
 *
 * Retrieves a specific prompt by ID or handle and formats it as
 * AI-readable markdown, including messages, model config, and version history.
 */
export async function handleGetPrompt(params: {
  idOrHandle: string;
  version?: number;
}): Promise<string> {
  const prompt = await apiGetPrompt(params.idOrHandle, params.version);

  const lines: string[] = [];
  lines.push(
    `# Prompt: ${prompt.name || prompt.handle || prompt.id}\n`
  );

  if (prompt.handle) lines.push(`**Handle**: ${prompt.handle}`);
  if (prompt.id) lines.push(`**ID**: ${prompt.id}`);
  if (prompt.description) lines.push(`**Description**: ${prompt.description}`);
  if (prompt.latestVersionNumber != null)
    lines.push(`**Latest Version**: v${prompt.latestVersionNumber}`);

  // Show model config
  const version = prompt.versions?.[0] ?? prompt;
  if (version.model) lines.push(`**Model**: ${version.model}`);
  if (version.modelProvider)
    lines.push(`**Provider**: ${version.modelProvider}`);

  // Show messages
  const messages = version.messages || prompt.prompt || [];
  if (Array.isArray(messages) && messages.length > 0) {
    lines.push("\n## Messages");
    for (const msg of messages) {
      lines.push(`\n### ${msg.role}`);
      lines.push(msg.content);
    }
  }

  // Show version history
  if (prompt.versions && prompt.versions.length > 0) {
    lines.push("\n## Version History");
    for (const v of prompt.versions.slice(0, 10)) {
      const versionNum = v.version ?? "?";
      const commitMsg = v.commitMessage || "No message";
      lines.push(`- **v${versionNum}**: ${commitMsg}`);
    }
    if (prompt.versions.length > 10) {
      lines.push(`... and ${prompt.versions.length - 10} more versions`);
    }
  }

  return lines.join("\n");
}

import {
  getPrompt as apiGetPrompt,
  type PromptVersion,
} from "../langwatch-api.js";

/**
 * Handles the platform_get_prompt MCP tool invocation.
 *
 * Retrieves a specific prompt by ID or handle. Defaults to an AI-readable
 * markdown digest covering messages, model config, parameters/inputs/outputs,
 * deployment tags, and version history; `format: "json"` instead returns the
 * raw API payload verbatim.
 */
export async function handleGetPrompt(params: {
  idOrHandle: string;
  version?: number;
  tag?: string;
  format?: "digest" | "json";
}): Promise<string> {
  const prompt = await apiGetPrompt(params.idOrHandle, { version: params.version, tag: params.tag });

  if (params.format === "json") {
    return JSON.stringify(prompt, null, 2);
  }

  const lines: string[] = [];
  lines.push(
    `# Prompt: ${prompt.name || prompt.handle || prompt.id}\n`
  );

  if (prompt.handle) lines.push(`**Handle**: ${prompt.handle}`);
  if (prompt.id) lines.push(`**ID**: ${prompt.id}`);
  if (prompt.latestVersionNumber != null)
    lines.push(`**Latest Version**: v${prompt.latestVersionNumber}`);

  // Resolve the version to render: the version the API returned first
  // (the requested/tagged/pinned/latest version, per apiGetPrompt's params).
  const version = (prompt.versions?.[0] ?? prompt) as PromptVersion;

  if (version.versionId) lines.push(`**Version ID**: ${version.versionId}`);
  if (version.model) lines.push(`**Model**: ${version.model}`);
  if (version.temperature != null)
    lines.push(`**Temperature**: ${version.temperature}`);
  if (version.maxTokens != null)
    lines.push(`**Max Tokens**: ${version.maxTokens}`);
  if (version.responseFormat)
    lines.push(`**Response Format**: ${JSON.stringify(version.responseFormat)}`);

  const renderFieldList = (
    heading: string,
    fields?: Array<{ identifier: string; type: string }>
  ) => {
    if (!fields || fields.length === 0) return;
    lines.push(`\n**${heading}**`);
    for (const field of fields) {
      lines.push(`- **${field.identifier}**: ${field.type}`);
    }
  };

  renderFieldList("Parameters", version.parameters);
  renderFieldList("Inputs", version.inputs);
  renderFieldList("Outputs", version.outputs);

  // Show messages
  const messages = version.messages || prompt.prompt || [];
  if (Array.isArray(messages) && messages.length > 0) {
    lines.push("\n## Messages");
    for (const msg of messages) {
      lines.push(`\n### ${msg.role}`);
      lines.push(msg.content);
    }
  }

  // Deployments: which tags (excluding the built-in "latest") the returned
  // version currently carries. Always rendered, even when empty, so an
  // empty section is never mistaken for "not checked" — but never claims
  // the prompt is "undeployed" or "not deployed anywhere", since a tag
  // absent from this version may still be deployed on another one (see
  // Version History below).
  lines.push("\n## Deployments");
  const deploymentTags = (version.tags ?? []).filter((tag) => tag !== "latest");
  for (const tag of deploymentTags) {
    lines.push(`- ${tag}`);
  }

  // Show version history, including each historical version's own
  // deployment tags so a tag present only on an older version is still
  // surfaced truthfully.
  if (prompt.versions && prompt.versions.length > 0) {
    lines.push("\n## Version History");
    for (const v of prompt.versions.slice(0, 10)) {
      const versionNum = v.version ?? "?";
      const commitMsg = v.commitMessage || "No message";
      const vTags = (v.tags ?? []).filter((tag) => tag !== "latest");
      const tagsSuffix = vTags.length > 0 ? ` (tags: ${vTags.join(", ")})` : "";
      lines.push(`- **v${versionNum}**: ${commitMsg}${tagsSuffix}`);
    }
    if (prompt.versions.length > 10) {
      lines.push(`... and ${prompt.versions.length - 10} more versions`);
    }
  }

  return lines.join("\n");
}

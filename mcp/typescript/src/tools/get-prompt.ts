import { getPrompt as apiGetPrompt } from "../langwatch-api.js";

interface DeploymentTag {
  name: string;
  versionId?: string;
}

/**
 * Normalizes one tag entry from the API. The API returns tag objects
 * ({ name, versionId }); plain strings are tolerated so a shape drift can
 * never crash the tool.
 */
function normalizeTag(tag: unknown): DeploymentTag | undefined {
  if (typeof tag === "string") return { name: tag };
  if (tag && typeof tag === "object" && "name" in tag) {
    const candidate = tag as { name: unknown; versionId?: unknown };
    if (typeof candidate.name === "string") {
      return {
        name: candidate.name,
        versionId:
          typeof candidate.versionId === "string"
            ? candidate.versionId
            : undefined,
      };
    }
  }
  return undefined;
}

/**
 * Handles the platform_get_prompt MCP tool invocation.
 *
 * Retrieves a specific prompt by ID or handle. The API returns the requested
 * version's data flattened to the top level (version, versionId, model,
 * messages, inputs/outputs, parameters, tags). Defaults to an AI-readable
 * markdown digest; `format: "json"` instead returns the raw API payload
 * verbatim.
 */
export async function handleGetPrompt(params: {
  idOrHandle: string;
  version?: number;
  tag?: string;
  format?: "digest" | "json";
}): Promise<string> {
  const prompt = await apiGetPrompt(params.idOrHandle, {
    version: params.version,
    tag: params.tag,
  });

  if (params.format === "json") {
    return JSON.stringify(prompt, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Prompt: ${prompt.name || prompt.handle || prompt.id}\n`);

  if (prompt.handle) lines.push(`**Handle**: ${prompt.handle}`);
  if (prompt.id) lines.push(`**ID**: ${prompt.id}`);
  if (prompt.version != null) lines.push(`**Version**: v${prompt.version}`);
  if (prompt.versionId) lines.push(`**Version ID**: ${prompt.versionId}`);
  if (prompt.commitMessage) lines.push(`**Commit**: ${prompt.commitMessage}`);
  if (prompt.model) lines.push(`**Model**: ${prompt.model}`);
  if (prompt.temperature != null)
    lines.push(`**Temperature**: ${prompt.temperature}`);
  if (prompt.maxTokens != null)
    lines.push(`**Max Tokens**: ${prompt.maxTokens}`);
  if (prompt.responseFormat)
    lines.push(`**Response Format**: ${JSON.stringify(prompt.responseFormat)}`);

  // Renders a field list of any shape the API may return: an array of
  // { identifier, type } entries (inputs/outputs), an object map of
  // name -> value (parameters), or absent/empty (no heading at all).
  const renderFieldList = ({
    heading,
    fields,
  }: {
    heading: string;
    fields: unknown;
  }) => {
    const entries: string[] = [];
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (field && typeof field === "object" && "identifier" in field) {
          const typed = field as { identifier: unknown; type?: unknown };
          entries.push(
            `- **${String(typed.identifier)}**: ${String(typed.type ?? "unknown")}`
          );
        } else {
          entries.push(`- ${JSON.stringify(field)}`);
        }
      }
    } else if (fields && typeof fields === "object") {
      for (const [key, value] of Object.entries(fields)) {
        entries.push(`- **${key}**: ${JSON.stringify(value)}`);
      }
    }
    if (entries.length === 0) return;
    lines.push(`\n**${heading}**`);
    lines.push(...entries);
  };

  renderFieldList({ heading: "Parameters", fields: prompt.parameters });
  renderFieldList({ heading: "Inputs", fields: prompt.inputs });
  renderFieldList({ heading: "Outputs", fields: prompt.outputs });

  const messages = prompt.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    lines.push("\n## Messages");
    for (const msg of messages) {
      lines.push(`\n### ${msg.role}`);
      lines.push(msg.content);
    }
  } else if (typeof prompt.prompt === "string" && prompt.prompt.length > 0) {
    lines.push("\n## Messages");
    lines.push("\n### system");
    lines.push(prompt.prompt);
  }

  // Deployments: every non-"latest" tag on the prompt, each shown with the
  // version it currently points to. Always rendered, even when empty, so an
  // empty section is never mistaken for "not checked" — and a tag pointing
  // at another version is listed truthfully against that version instead of
  // being implied undeployed.
  lines.push("\n## Deployments");
  const tags = Array.isArray(prompt.tags) ? prompt.tags : [];
  for (const rawTag of tags) {
    const tag = normalizeTag(rawTag);
    if (!tag || tag.name === "latest") continue;
    const target = tag.versionId ?? "unknown version";
    const marker =
      tag.versionId && tag.versionId === prompt.versionId
        ? " (this version)"
        : "";
    lines.push(`- ${tag.name} → ${target}${marker}`);
  }

  return lines.join("\n");
}

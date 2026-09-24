import { getPrompt as apiGetPrompt, type PromptDetailResponse } from "../langwatch-api.js";

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
        versionId: typeof candidate.versionId === "string" ? candidate.versionId : undefined,
      };
    }
  }
  return undefined;
}

function fieldEntry(field: unknown): string {
  if (field && typeof field === "object" && "identifier" in field) {
    const typed = field as { identifier: unknown; type?: unknown };
    return `- **${String(typed.identifier)}**: ${String(typed.type ?? "unknown")}`;
  }
  return `- ${JSON.stringify(field)}`;
}

// Renders a field list of any shape the API may return: an array of
// { identifier, type } entries (inputs/outputs), an object map of
// name -> value (parameters), or absent/empty (no heading at all).
function fieldListLines({ heading, fields }: { heading: string; fields: unknown }): string[] {
  const entries: string[] = [];
  if (Array.isArray(fields)) {
    entries.push(...fields.map(fieldEntry));
  } else if (fields && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields)) {
      entries.push(`- **${key}**: ${JSON.stringify(value)}`);
    }
  }
  if (entries.length === 0) return [];
  return [`\n**${heading}**`, ...entries];
}

function messageLines(prompt: PromptDetailResponse): string[] {
  const messages = prompt.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    return ["\n## Messages", ...messages.flatMap((msg) => [`\n### ${msg.role}`, msg.content])];
  }
  if (typeof prompt.prompt === "string" && prompt.prompt.length > 0) {
    return ["\n## Messages", "\n### system", prompt.prompt];
  }
  return [];
}

// Deployments: every non-"latest" tag on the prompt, each shown with the
// version it currently points to. Always rendered, even when empty, so an
// empty section is never mistaken for "not checked" — and a tag pointing
// at another version is listed truthfully instead of implied undeployed.
function deploymentLines(prompt: PromptDetailResponse): string[] {
  const lines = ["\n## Deployments"];
  const tags = Array.isArray(prompt.tags) ? prompt.tags : [];
  for (const rawTag of tags) {
    const tag = normalizeTag(rawTag);
    if (!tag || tag.name === "latest") continue;
    const target = tag.versionId ?? "unknown version";
    const marker = tag.versionId && tag.versionId === prompt.versionId ? " (this version)" : "";
    lines.push(`- ${tag.name} → ${target}${marker}`);
  }
  return lines;
}

// Retrieves a prompt by ID/handle; returns a markdown digest by default or
// raw JSON if format: "json" is specified.
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
  if (prompt.temperature != null) lines.push(`**Temperature**: ${prompt.temperature}`);
  if (prompt.maxTokens != null) lines.push(`**Max Tokens**: ${prompt.maxTokens}`);
  if (prompt.responseFormat)
    lines.push(`**Response Format**: ${JSON.stringify(prompt.responseFormat)}`);

  lines.push(...fieldListLines({ heading: "Parameters", fields: prompt.parameters }));
  lines.push(...fieldListLines({ heading: "Inputs", fields: prompt.inputs }));
  lines.push(...fieldListLines({ heading: "Outputs", fields: prompt.outputs }));
  lines.push(...messageLines(prompt));
  lines.push(...deploymentLines(prompt));

  return lines.join("\n");
}

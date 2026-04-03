import { assignPromptTag as apiAssignPromptTag } from "../langwatch-api.js";

export async function handleAssignPromptTag(params: {
  idOrHandle: string;
  tag: string;
  versionId: string;
}): Promise<string> {
  await apiAssignPromptTag(params.idOrHandle, params.tag, params.versionId);

  const lines: string[] = [];
  lines.push("Tag assigned successfully!\n");
  lines.push(`**Prompt**: ${params.idOrHandle}`);
  lines.push(`**Tag**: ${params.tag}`);
  lines.push(`**Version ID**: ${params.versionId}`);
  return lines.join("\n");
}

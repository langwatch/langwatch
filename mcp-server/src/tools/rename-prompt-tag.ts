import { renamePromptTag as apiRenamePromptTag } from "../langwatch-api.js";

export async function handleRenamePromptTag(params: {
  tag: string;
  name: string;
}): Promise<string> {
  await apiRenamePromptTag({ tag: params.tag, name: params.name });

  const lines: string[] = [];
  lines.push("Tag renamed successfully!\n");
  lines.push(`**Old name**: ${params.tag}`);
  lines.push(`**New name**: ${params.name}`);
  return lines.join("\n");
}

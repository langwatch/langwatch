import { deletePromptTag as apiDeletePromptTag } from "../langwatch-api.js";

export async function handleDeletePromptTag(params: {
  tag: string;
}): Promise<string> {
  await apiDeletePromptTag(params.tag);

  const lines: string[] = [];
  lines.push("Tag deleted successfully!\n");
  lines.push(`**Tag**: ${params.tag}`);
  return lines.join("\n");
}

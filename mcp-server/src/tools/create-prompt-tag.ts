import { createPromptTag as apiCreatePromptTag } from "../langwatch-api.js";

export async function handleCreatePromptTag(params: {
  name: string;
}): Promise<string> {
  await apiCreatePromptTag(params.name);

  const lines: string[] = [];
  lines.push("Tag created successfully!\n");
  lines.push(`**Name**: ${params.name}`);
  return lines.join("\n");
}

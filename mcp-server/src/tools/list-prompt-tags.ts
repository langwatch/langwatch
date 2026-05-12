import { listPromptTags as apiListPromptTags } from "../langwatch-api.js";

export async function handleListPromptTags(): Promise<string> {
  const tags = (await apiListPromptTags()) as Array<{
    id: string;
    name: string;
    createdAt?: string;
  }>;

  if (!tags || tags.length === 0) {
    return "No prompt tags found. The `latest` tag is always available.";
  }

  const lines: string[] = [];
  lines.push("# Prompt Tags\n");
  for (const tag of tags) {
    const created = tag.createdAt ? ` (created ${tag.createdAt})` : "";
    lines.push(`- **${tag.name}**${created}`);
  }
  return lines.join("\n");
}

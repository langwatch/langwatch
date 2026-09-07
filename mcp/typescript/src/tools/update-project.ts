import { updateProject as apiUpdateProject } from "../langwatch-api-projects.js";

export async function handleUpdateProject(params: {
  id: string;
  name?: string;
  language?: string;
  framework?: string;
  piiRedactionLevel?: "STRICT" | "ESSENTIAL" | "DISABLED";
}): Promise<string> {
  const project = await apiUpdateProject(params);

  const lines: string[] = [];
  lines.push(`Project updated successfully!\n`);
  lines.push(`**Name**: ${project.name}`);
  lines.push(`**ID**: ${project.id}`);
  lines.push(`**Slug**: ${project.slug}`);
  lines.push(`**Language**: ${project.language}`);
  lines.push(`**Framework**: ${project.framework}`);
  lines.push(`**PII Redaction**: ${project.piiRedactionLevel}`);

  return lines.join("\n");
}

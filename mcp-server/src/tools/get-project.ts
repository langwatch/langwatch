import { getProject as apiGetProject } from "../langwatch-api-projects.js";

export async function handleGetProject(params: {
  id: string;
}): Promise<string> {
  const project = await apiGetProject(params.id);

  const lines: string[] = [];
  lines.push(`# ${project.name}\n`);
  lines.push(`**ID**: ${project.id}`);
  lines.push(`**Slug**: ${project.slug}`);
  lines.push(`**Language**: ${project.language}`);
  lines.push(`**Framework**: ${project.framework}`);
  lines.push(`**Team ID**: ${project.teamId}`);
  lines.push(`**PII Redaction**: ${project.piiRedactionLevel}`);
  lines.push(`**Created**: ${project.createdAt}`);
  lines.push(`**Updated**: ${project.updatedAt}`);

  return lines.join("\n");
}

import { archiveProject as apiArchiveProject } from "../langwatch-api-projects.js";

export async function handleArchiveProject(params: {
  id: string;
}): Promise<string> {
  const result = await apiArchiveProject(params.id);

  return (
    `Project archived successfully.\n\n` +
    `**Name**: ${result.name}\n` +
    `**ID**: ${result.id}\n` +
    `**Archived At**: ${result.archivedAt}`
  );
}

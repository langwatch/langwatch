import { listProjects as apiListProjects } from "../langwatch-api-projects.js";

export async function handleListProjects(params?: {
  page?: number;
  limit?: number;
}): Promise<string> {
  const result = await apiListProjects({
    page: params?.page,
    limit: params?.limit ?? 100,
  });
  const projects = result.data;

  if (!Array.isArray(projects) || projects.length === 0) {
    return "No projects found in this organization.\n\n> Tip: Use `platform_create_project` to create your first project.";
  }

  const lines: string[] = [];
  lines.push(`# Projects (${result.pagination.total} total)\n`);

  for (const p of projects) {
    lines.push(`## ${p.name}`);
    lines.push(`**ID**: ${p.id}`);
    lines.push(`**Slug**: ${p.slug}`);
    lines.push(`**Language**: ${p.language}`);
    lines.push(`**Framework**: ${p.framework}`);
    lines.push(`**Updated**: ${p.updatedAt}`);
    lines.push("");
  }

  if (result.pagination.totalPages > 1) {
    lines.push(
      `> Showing page ${result.pagination.page} of ${result.pagination.totalPages}. Use \`page\` parameter to navigate.`,
    );
  }

  lines.push(
    "> Use `platform_get_project` with the ID to see full project details.",
  );

  return lines.join("\n");
}

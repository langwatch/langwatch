import type { Prisma, PrismaClient } from "@prisma/client";
import type { LimitType } from "./types";

export type LimitBreakdownResource = { id: string; name: string };

export type LimitBreakdownProject = {
  projectId: string;
  projectName: string;
  projectSlug: string;
  resources: LimitBreakdownResource[];
};

/**
 * Limit types whose counted resources can be listed and linked per project.
 * Other limit types (members, teams, messages, ...) have no per-project
 * resource list to show, so they return an empty breakdown.
 */
const BREAKDOWN_LIMIT_TYPES = ["datasets", "workflows", "prompts"] as const;

export function limitTypeHasBreakdown(limitType: LimitType): boolean {
  return (BREAKDOWN_LIMIT_TYPES as readonly string[]).includes(limitType);
}

/**
 * Lists the resources counting toward an org-wide limit, grouped by project, so
 * the upgrade dialog can show where a count like "4 / 3" comes from. Mirrors the
 * count repository's RLS-safe pattern: resolve the org's project ids first, then
 * filter resources by `projectId in`. Projects with no matching resources are
 * dropped.
 */
export async function getLimitBreakdownByProject(
  prisma: PrismaClient | Prisma.TransactionClient,
  {
    organizationId,
    limitType,
  }: { organizationId: string; limitType: LimitType },
): Promise<LimitBreakdownProject[]> {
  if (!limitTypeHasBreakdown(limitType)) return [];

  const projects = await prisma.project.findMany({
    where: { team: { organizationId }, archivedAt: null },
    select: { id: true, name: true, slug: true },
  });
  if (projects.length === 0) return [];

  const rows = await listResources(
    prisma,
    limitType,
    projects.map((p) => p.id),
  );

  const byProject = new Map<string, LimitBreakdownResource[]>();
  for (const row of rows) {
    const list = byProject.get(row.projectId) ?? [];
    list.push({ id: row.id, name: row.name });
    byProject.set(row.projectId, list);
  }

  return projects
    .map((p) => ({
      projectId: p.id,
      projectName: p.name,
      projectSlug: p.slug,
      resources: byProject.get(p.id) ?? [],
    }))
    .filter((p) => p.resources.length > 0);
}

async function listResources(
  prisma: PrismaClient | Prisma.TransactionClient,
  limitType: LimitType,
  projectIds: string[],
): Promise<{ id: string; name: string; projectId: string }[]> {
  switch (limitType) {
    case "datasets":
      return prisma.dataset.findMany({
        where: { projectId: { in: projectIds }, archivedAt: null },
        select: { id: true, name: true, projectId: true },
        orderBy: { createdAt: "desc" },
      });
    case "workflows":
      return prisma.workflow.findMany({
        where: { projectId: { in: projectIds }, archivedAt: null },
        select: { id: true, name: true, projectId: true },
        orderBy: { updatedAt: "desc" },
      });
    case "prompts":
      return prisma.llmPromptConfig.findMany({
        where: { projectId: { in: projectIds }, deletedAt: null },
        select: { id: true, name: true, projectId: true },
        orderBy: { createdAt: "desc" },
      });
    default:
      return [];
  }
}

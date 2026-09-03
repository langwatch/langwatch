import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { StoredObjectsRepository } from "#repositories/clickhouse/stored-objects.repository";
import type { MigrationInventory } from "../services/object-storage-migration.service";

/**
 * The three pages a migration walks: the projects in scope, the live
 * stored-object rows under each, and the datasets whose chunks ride along.
 *
 * `privateOrganizations` is the BYOC exclusion — an organization routed to its
 * own S3 account is not this deployment's to move — and it arrives as the
 * route map the process was configured with rather than being read here.
 *
 * Reads a repository and Prisma directly, which is what makes this an
 * adapter rather than a task: a task calls services and adapters, never a
 * repository.
 */
export function createMigrationInventory({
  repository,
  prisma,
  privateOrganizations,
}: {
  repository: StoredObjectsRepository;
  prisma: Pick<PrismaClient, "project" | "dataset">;
  privateOrganizations: ReadonlyMap<string, unknown>;
}): MigrationInventory {
  return {
    listProjectsPage: async ({ afterId, limit }) => {
      const projects = await prisma.project.findMany({
        where: afterId ? { id: { gt: afterId } } : undefined,
        orderBy: { id: "asc" },
        take: limit,
        select: {
          id: true,
          team: { select: { organizationId: true } },
        },
      });
      return projects.map((project) => ({
        id: project.id,
        privateS3: privateOrganizations.has(project.team.organizationId),
      }));
    },
    listStoredObjectsPage: (projectId, { afterId, limit }) =>
      repository.findLiveRowsByProjectPage({ projectId, afterId, limit }),
    listDatasetsPage: (projectId, { afterId, limit }) =>
      prisma.dataset.findMany({
        // projectId is mandatory here twice over: the multitenancy middleware
        // rejects Dataset queries without it, and the migration's own scope
        // guarantees (BYOC exclusion) rely on only eligible projects being
        // asked for.
        where: { projectId, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: "asc" },
        take: limit,
        select: {
          id: true,
          projectId: true,
          contentLayout: true,
          status: true,
          chunkCount: true,
        },
      }),
  };
}

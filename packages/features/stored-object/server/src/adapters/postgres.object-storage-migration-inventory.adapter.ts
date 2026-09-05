import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { StoredObjectsRepository } from "#repositories/stored-objects.repository";
import type { StoredObject } from "#repositories/stored-objects.row";
import type {
  MigrationDataset,
  MigrationInventory,
  MigrationPageRequest,
  MigrationProject,
} from "../services/object-storage-migration.service";

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
export class PostgresObjectStorageMigrationInventoryAdapter implements MigrationInventory {
  static create(input: {
    repository: StoredObjectsRepository;
    prisma: Pick<PrismaClient, "project" | "dataset">;
    privateOrganizations: ReadonlyMap<string, unknown>;
  }): PostgresObjectStorageMigrationInventoryAdapter {
    return new PostgresObjectStorageMigrationInventoryAdapter(
      input.repository,
      input.prisma,
      input.privateOrganizations,
    );
  }

  private constructor(
    private readonly repository: StoredObjectsRepository,
    private readonly prisma: Pick<PrismaClient, "project" | "dataset">,
    private readonly privateOrganizations: ReadonlyMap<string, unknown>,
  ) {}

  async listProjectsPage({ afterId, limit }: MigrationPageRequest): Promise<MigrationProject[]> {
    const projects = await this.prisma.project.findMany({
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
      privateS3: this.privateOrganizations.has(project.team.organizationId),
    }));
  }

  listStoredObjectsPage(
    projectId: string,
    { afterId, limit }: MigrationPageRequest,
  ): Promise<StoredObject[]> {
    return this.repository.findLiveRowsByProjectPage({ projectId, afterId, limit });
  }

  listDatasetsPage(
    projectId: string,
    { afterId, limit }: MigrationPageRequest,
  ): Promise<MigrationDataset[]> {
    return this.prisma.dataset.findMany({
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
    });
  }
}

import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** Only what this repository touches: a project's owning organization. */
export type StoredObjectProjectOrganizationDatabase = Pick<PrismaClient, "project">;

export class PrismaStoredObjectProjectOrganizationRepository {
  static create(
    database: StoredObjectProjectOrganizationDatabase,
  ): PrismaStoredObjectProjectOrganizationRepository {
    return new PrismaStoredObjectProjectOrganizationRepository(database);
  }

  private constructor(private readonly database: StoredObjectProjectOrganizationDatabase) {}

  async findOrganizationId(projectId: string): Promise<string | null> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });

    return project?.team?.organizationId ?? null;
  }
}

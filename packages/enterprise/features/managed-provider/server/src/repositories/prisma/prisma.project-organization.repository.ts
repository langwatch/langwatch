import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ManagedProviderProjectRepository } from "../../ports/managed-provider-project.port";

export class PrismaManagedProviderProjectRepository extends ManagedProviderProjectRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(
    database: object,
  ): PrismaManagedProviderProjectRepository {
    return new PrismaManagedProviderProjectRepository(database as PrismaClient);
  }

  async tryGetOrganizationId(projectId: string): Promise<string | null> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team.organizationId ?? null;
  }
}

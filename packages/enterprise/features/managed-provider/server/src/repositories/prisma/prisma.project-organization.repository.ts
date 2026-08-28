import { ManagedProviderProjectRepository } from "../../ports/managed-provider-project.port";

type ManagedProviderProjectDatabase = {
  project: {
    findUnique(input: {
      where: { id: string };
      select: { team: { select: { organizationId: true } } };
    }): Promise<{ team: { organizationId: string } } | null>;
  };
};

export class PrismaManagedProviderProjectRepository extends ManagedProviderProjectRepository {
  private constructor(private readonly database: ManagedProviderProjectDatabase) {
    super();
  }

  static create(database: ManagedProviderProjectDatabase): PrismaManagedProviderProjectRepository {
    return new PrismaManagedProviderProjectRepository(database);
  }

  async tryGetOrganizationId(projectId: string): Promise<string | null> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team.organizationId ?? null;
  }
}

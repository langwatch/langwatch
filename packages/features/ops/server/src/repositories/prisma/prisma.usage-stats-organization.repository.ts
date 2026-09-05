import {
  UsageStatsOrganizationRepositoryPort,
  type UsageStatsOrganization,
  type UsageStatsOrganizationDatabase,
} from "../../ports/usage-stats-worker.port";

export class PrismaUsageStatsOrganizationRepository extends UsageStatsOrganizationRepositoryPort {
  private constructor(private readonly database: UsageStatsOrganizationDatabase) {
    super();
  }

  static create(database: UsageStatsOrganizationDatabase): PrismaUsageStatsOrganizationRepository {
    return new PrismaUsageStatsOrganizationRepository(database);
  }

  listForUsageStats(): Promise<UsageStatsOrganization[]> {
    return this.database.organization.findMany({
      select: { id: true, name: true },
    });
  }
}

import type {
  UsageStatsOrganization,
  UsageStatsOrganizationDatabase,
} from "../../app/ops.app.ts";
import { UsageStatsOrganizationRepository } from "../observe/usage-stats.repository.ts";

export class PrismaUsageStatsOrganizationRepository extends UsageStatsOrganizationRepository {
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

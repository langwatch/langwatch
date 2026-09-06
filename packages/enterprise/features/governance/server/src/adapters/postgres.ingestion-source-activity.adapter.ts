import type { GovernanceClickHouseResolverPort } from "../ports/ingestion-source-activity.port.ts";
import { PrismaActivityMonitorRepository } from "../repositories/prisma/prisma.ingestion-source-activity.repository.ts";
import { ActivityMonitorService } from "../services/ingestion-source-activity.service.ts";

/** Binds Postgres and ClickHouse infrastructure to the activity service. */
export class PostgresIngestionSourceActivityAdapter {
  private constructor(
    private readonly options: {
      database: object;
      clickhouse: GovernanceClickHouseResolverPort;
    },
  ) {}

  static create(options: {
    database: object;
    clickhouse: GovernanceClickHouseResolverPort;
  }): PostgresIngestionSourceActivityAdapter {
    return new PostgresIngestionSourceActivityAdapter(options);
  }

  build(): ActivityMonitorService {
    return ActivityMonitorService.create(
      PrismaActivityMonitorRepository.create({
        prisma: this.options.database,
        clickhouse: this.options.clickhouse,
      }),
    );
  }
}

import type { GovernanceClickHouseResolverPort } from "../ports/ingestion-source-activity.port.ts";
import {
  PrismaActivityMonitorRepository,
  type ActivityMonitorDatabase,
} from "../repositories/prisma/prisma.ingestion-source-activity.repository.ts";
import { ActivityMonitorService } from "../services/ingestion-source-activity.service.ts";

/** Binds Postgres and ClickHouse infrastructure to the activity service. */
export class PostgresIngestionSourceActivityAdapter {
  private constructor(
    private readonly options: {
      database: ActivityMonitorDatabase;
      clickhouse: GovernanceClickHouseResolverPort;
    },
  ) {}

  static create(options: {
    database: ActivityMonitorDatabase;
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

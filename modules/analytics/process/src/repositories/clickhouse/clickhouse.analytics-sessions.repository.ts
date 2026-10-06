import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { AnalyticsSessionsRepository } from "../analytics-sessions.repository.ts";
import type { EvaluationAnalyticsClickHouseClient } from "./clickhouse.analytics-persistence.repository.ts";
import { ClickHouseAnalyticsSessionRepository } from "./clickhouse.analytics-session.repository.ts";

/** The routed ClickHouse client as the registry hands it: one tenant-keyed session per call. */
export class ClickHouseAnalyticsSessionsRepository extends AnalyticsSessionsRepository {
  static create(clickhouse: ClickHouseQueryClient): ClickHouseAnalyticsSessionsRepository {
    return new ClickHouseAnalyticsSessionsRepository(clickhouse);
  }

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  resolve(tenantId: string): Promise<EvaluationAnalyticsClickHouseClient> {
    return Promise.resolve(
      ClickHouseAnalyticsSessionRepository.create({ clickhouse: this.clickhouse, tenantId }),
    );
  }
}

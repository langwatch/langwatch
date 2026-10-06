import { AnalyticsSessionsRepository } from "../analytics-sessions.repository.ts";
import type { EvaluationAnalyticsClickHouseClient } from "../clickhouse/clickhouse.analytics-persistence.repository.ts";
import { AnalyticsClientUnavailableError } from "../clickhouse/clickhouse.analytics.repository.ts";

/** The memory tier opens no ClickHouse: a tenant session is refused by name, never faked. */
export class MemoryAnalyticsSessionsRepository extends AnalyticsSessionsRepository {
  static create(): MemoryAnalyticsSessionsRepository {
    return new MemoryAnalyticsSessionsRepository();
  }

  private constructor() {
    super();
  }

  resolve(tenantId: string): Promise<EvaluationAnalyticsClickHouseClient> {
    return Promise.reject(new AnalyticsClientUnavailableError(tenantId));
  }
}

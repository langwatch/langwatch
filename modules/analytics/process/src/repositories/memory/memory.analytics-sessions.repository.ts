import { AnalyticsSessionsRepository } from "../analytics-sessions.repository.ts";
import type { EvaluationAnalyticsClickHouseClient } from "../clickhouse/clickhouse.analytics-persistence.repository.ts";

/**
 * The memory tier holds no analytics rows (as its recency twin says): a tenant's session takes
 * a write and keeps none. Reads go through the routed client, not the session.
 */
const emptySession: EvaluationAnalyticsClickHouseClient = {
  insert: () => Promise.resolve(),
};

export class MemoryAnalyticsSessionsRepository extends AnalyticsSessionsRepository {
  static create(): MemoryAnalyticsSessionsRepository {
    return new MemoryAnalyticsSessionsRepository();
  }

  private constructor() {
    super();
  }

  resolve(_tenantId: string): Promise<EvaluationAnalyticsClickHouseClient> {
    return Promise.resolve(emptySession);
  }
}

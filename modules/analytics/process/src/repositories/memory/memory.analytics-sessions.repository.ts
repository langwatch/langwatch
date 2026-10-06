import { AnalyticsSessionsRepository } from "../analytics-sessions.repository.ts";
import type { EvaluationAnalyticsClickHouseClient } from "../clickhouse/clickhouse.analytics-persistence.repository.ts";

/**
 * The memory tier holds no analytics rows (as its recency twin says): a tenant's session takes
 * a write and keeps none, and answers every read with no rows rather than refusing it.
 */
const emptySession: EvaluationAnalyticsClickHouseClient = {
  insert: () => Promise.resolve(),
  query: () => Promise.resolve({ json: () => Promise.resolve([]) }),
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

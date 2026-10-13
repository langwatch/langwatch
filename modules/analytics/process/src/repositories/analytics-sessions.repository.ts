import type { EvaluationAnalyticsClickHouseClient } from "./clickhouse/clickhouse.analytics-persistence.repository.ts";

/** One tenant's ClickHouse session, for the reads not yet behind a named repository. */
export abstract class AnalyticsSessionsRepository {
  abstract resolve(tenantId: string): Promise<EvaluationAnalyticsClickHouseClient>;
}

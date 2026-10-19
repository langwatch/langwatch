import type { ClickHouseSettings } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { nowInstant } from "@langwatch/time";

import type { EvaluationAnalyticsClickHouseClient } from "./clickhouse.analytics-persistence.repository.ts";
import { translateClickHouseQueryError } from "./clickhouse.query-error-translation.mapper.ts";

/**
 * Adapts the process's routing `clickhouse` member to the per-tenant session Analytics'
 * repositories read through. Every analytics read passes `query`, so a failed read is
 * translated here once the client's retries are spent; inserts keep the raw error.
 */
export class ClickHouseAnalyticsSessionRepository implements EvaluationAnalyticsClickHouseClient {
  static create({
    clickhouse,
    tenantId,
  }: Readonly<{
    clickhouse: ClickHouseQueryClient;
    tenantId: string;
  }>): ClickHouseAnalyticsSessionRepository {
    return new ClickHouseAnalyticsSessionRepository(clickhouse, tenantId);
  }

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<{ json(): Promise<Record<string, unknown>[]> }> {
    const startedAt = nowInstant().epochMilliseconds;
    try {
      const { rows } = await this.clickhouse.query<Record<string, unknown>>({
        tenantId: this.tenantId,
        sql: input.query,
        params: input.query_params,
        settings: input.clickhouse_settings as Record<string, string | number> | undefined,
      });
      return { json: () => Promise.resolve(rows) };
    } catch (error) {
      throw translateClickHouseQueryError(error, nowInstant().epochMilliseconds - startedAt);
    }
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
    });
    return undefined;
  }
}

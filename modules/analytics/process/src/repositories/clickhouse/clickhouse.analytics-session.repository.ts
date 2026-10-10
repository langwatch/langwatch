import type { ClickHouseSettings } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { EvaluationAnalyticsClickHouseClient } from "./clickhouse.analytics-persistence.repository.ts";

/**
 * Adapts the process's one routing `clickhouse` member to the per-tenant session
 * shape Analytics' repositories expect. Not a second connection — the member already
 * routes and guards every statement by `tenantId`; this just carries that tenant on.
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
    const { rows } = await this.clickhouse.query<Record<string, unknown>>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
    });
    return { json: () => Promise.resolve(rows) };
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

import type { ClickHouseSettings } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { EvaluationAnalyticsClickHouseClient } from "./clickhouse.analytics-persistence.repository.ts";

/**
 * The per-tenant session Analytics' repositories insert their own tenant's rows through, keeping
 * the raw error. Every read is a built statement sent with `read` (ADR-202).
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

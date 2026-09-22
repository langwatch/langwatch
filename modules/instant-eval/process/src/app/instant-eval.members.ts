/**
 * What the process hands this module (ADR-147). The ClickHouse surface is
 * declared structurally so the package does not depend on the driver.
 */

export type InstantEvalClickHouseClient = {
  query<T>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<{ json(): Promise<T[]> }>;
  insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown>;
};

/** Resolves the tenant's ClickHouse client; every read names the tenant first. */
export type InstantEvalClickHouseResolver = (
  tenantId: string,
) => Promise<InstantEvalClickHouseClient>;

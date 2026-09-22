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

/**
 * The process's one routing ClickHouse member, carried per tenant. Not a
 * second connection — the member already routes and guards every statement.
 */
export type InstantEvalClickHouseMember = {
  query<T>(input: {
    tenantId: string;
    sql: string;
    params?: Record<string, unknown>;
    settings?: Record<string, string | number>;
  }): Promise<{ rows: T[] }>;
  insert(input: {
    tenantId: string;
    table: string;
    rows: Record<string, unknown>[];
    settings?: Record<string, string | number>;
  }): Promise<unknown>;
};

/**
 * The ClickHouse surface this feature uses, structurally, so the package
 * does not depend on the driver — the driver's stricter types (a nested-map
 * setting, a typed insert result) are not assignable here (contravariance).
 */
export type GatewayClickHouseClient = {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
    /** Set when the statement genuinely spans tenants; see the tenant-scope guard. */
    unscoped?: { reason: string };
    /** One organisation's projects a `TenantId IN (...)` read binds, exactly. */
    tenantIds?: readonly string[];
    /** Abandons the read, retries included, once it aborts. */
    signal?: AbortSignal;
  }): Promise<{ json<T = unknown>(): Promise<T[]> }>;
  insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown>;
};

export type GatewayClickHouseResolver = (tenantId: string) => Promise<GatewayClickHouseClient>;

/** Resolves the tenant-scoped ClickHouse client at the Gateway boundary. */
export interface GatewayClickHouse {
  resolve(tenantId: string): Promise<GatewayClickHouseClient>;
}

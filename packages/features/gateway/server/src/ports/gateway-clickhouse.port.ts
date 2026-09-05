/**
 * The ClickHouse surface this feature uses, structurally, so the package does not depend on the driver. clickhouse_settings is scalars-only: the driver's type also admits a nested map, and declaring that here made the real client un-assignable (a parameter position is contravariant), yet nothing here ever passes a map setting. insert answers unknown for the mirror reason — Promise<InsertResult> isn't assignable to Promise<void> — and no call site reads what insert answers anyway.
 */
export type GatewayClickHouseClient = {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
    /** Set when the statement genuinely spans tenants; see the tenant-scope guard. */
    unscoped?: { reason: string };
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
export abstract class GatewayClickHousePort {
  abstract resolve(tenantId: string): Promise<GatewayClickHouseClient>;
}

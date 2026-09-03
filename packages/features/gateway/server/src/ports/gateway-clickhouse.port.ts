/**
 * The ClickHouse surface this feature uses, structurally, so the package does
 * not depend on the driver.
 *
 * `clickhouse_settings` values are scalars only. The driver's own type also
 * admits a nested map setting, and declaring that here made the real client
 * un-assignable to this port: a parameter position is contravariant, so a port
 * that accepts MORE than the driver does cannot be satisfied by the driver.
 * Nothing in this feature has ever passed a map setting — every call site
 * passes `async_insert`, `wait_for_async_insert` or `max_execution_time` — so
 * the narrow type is both correct and what makes the driver fit.
 *
 * `insert` answers `unknown` for the mirror-image reason. The driver resolves
 * an `InsertResult`, and `Promise<InsertResult>` is not assignable to
 * `Promise<void>` — the return-position void relaxation applies to a function
 * type, not through a `Promise` instantiation — so declaring `void` here made
 * the real client un-assignable again. No call site in this feature reads what
 * `insert` answers; every one of the three awaits it and discards it.
 */
export type GatewayClickHouseClient = {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
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
